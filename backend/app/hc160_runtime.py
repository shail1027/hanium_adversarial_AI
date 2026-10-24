"""In-process bridge to HC160. Session and token lifetime is one server worker."""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from pathlib import Path
import random
import sys
from threading import RLock
import uuid


class HC160Runtime:
    def __init__(self, config):
        self.config = config
        self._lock = RLock()
        self._cli = None
        self.store = None
        self.sessions = None
        self.tokens = None

    def _load(self):
        if self._cli is None:
            repo = str(Path(self.config.repo_path).resolve())
            if repo not in sys.path:
                sys.path.insert(0, repo)
            from src.face_auth import cli
            if not Path(cli.__file__).resolve().is_relative_to(Path(repo)):
                raise RuntimeError("HC160 module was loaded from another repository")
            self._cli = cli
            self.store = cli.InMemoryStore()
            self.sessions = cli.SessionService(
                self.store, challenge_kinds=("HEAD_LEFT", "HEAD_RIGHT")
            )
            self.tokens = cli.TokenService(self.store)
        return self._cli

    def make_frame(self, frame_id, captured_at_monotonic, image_bgr, source_time_ms=None):
        return self._load().FramePacket(
            frame_id, captured_at_monotonic, image_bgr, source_time_ms=source_time_ms,
        )

    def create(self, user_id, purpose, context_hash):
        with self._lock:
            cli = self._load()
            session = self.sessions.create_session(
                user_id=user_id, purpose=purpose,
                transaction_context_hash=context_hash,
                security_profile=cli.SecurityProfile.FULL,
            )
            return session, self.sessions.issue_challenge(session.session_id)

    def illumination(self, nonce, started_at_monotonic):
        cli = self._load()
        # Defaults are the exact FULL CLI defaults. No browser-selected colors.
        args = cli.build_parser().parse_args([
            "authenticate", "--video", "unused", "--template", "unused", "--user-id", "unused",
        ])
        return cli.IlluminationChallengeIssuer(cli._illumination_config(args)).issue(
            random.SystemRandom(), nonce=nonce,
            issued_at_monotonic=started_at_monotonic,
            accessibility=cli.AccessibilityProfile(args.illumination_accessibility),
        )

    def enroll(self, user_id, frames, template_path, calibration_path):
        with self._lock:
            cli = self._load()
            args = self.config.enrollment_args(user_id, template_path, calibration_path)
            detector = cli.MTCNNFaceDetector(device=args.device)
            embedder = cli.FaceNetEmbedder(device=args.device)
            quality = cli._quality_gate(args)
            crops = []
            excluded = Counter()
            for frame in frames:
                faces = detector.detect(frame.image_bgr)
                count = cli.face_count_gate(faces)
                if count.status is not cli.GateStatus.PASS:
                    excluded[count.reason_codes[0]] += 1
                    continue
                result = quality.evaluate(frame.image_bgr, faces[0].bbox).result
                if result.status is not cli.GateStatus.PASS:
                    excluded["+".join(result.reason_codes)] += 1
                    continue
                crops.append(faces[0].crop)
            template, artifact = cli.create_calibrated_template(
                crops, embedder, input_count=len(frames),
                exclusion_reasons=dict(excluded),
                quality_policy_version=f"quality-v1:{cli.stable_json_sha256(asdict(quality.config))}",
                runtime={"device": args.device or "cpu"},
                artifact_id=f"registration-calibration-{uuid.uuid4()}",
                min_frames=max(2, args.min_valid_frames),
            )
            cli.save_calibrated_template(
                template, artifact, cli._template_repository(args),
                template_path=template_path, calibration_path=calibration_path,
                user_id=user_id, key_id=args.template_key_id,
            )
            return {
                "status": "ENROLLED", "captured_frames": len(frames),
                "valid_frames": len(crops), "excluded_frames": len(frames) - len(crops),
                "exclusion_reasons": dict(excluded), "template_version": template.template_version,
                "registration_calibration_id": artifact["artifact_id"],
            }

    def _bound_calibration(self, cli, args, template, calibration_path):
        from src.face_auth.application.registration_calibration import (
            RegistrationCalibrationError, load_registration_calibration,
        )
        artifact = load_registration_calibration(calibration_path)
        # The baseline selector falls back early for unvalidated artifacts. Binding
        # still must be checked at this server boundary before permitting fallback.
        if (
            artifact.subject_reference != f"template:{template.template_version}"
            or artifact.model_version != template.model_version
            or artifact.preprocessing_version != template.alignment_version
            or dict(artifact.runtime) != {"device": args.device or "cpu"}
        ):
            raise RegistrationCalibrationError("registration calibration binding mismatch")
        return cli.RegistrationCalibrationRuntimeAdapter(
            population_threshold=args.threshold,
            population_threshold_version=args.threshold_version,
            runtime={"device": args.device or "cpu"},
            min_probe_frames=args.min_valid_frames,
        ).select(template=template, artifact_path=calibration_path)

    def evaluate(self, session_id, user_id, source_ip, frames,
                 challenge_start_frame_id, illumination, template_path, calibration_path):
        with self._lock:
            cli = self._load()
            session = self.sessions._active_session(session_id)
            challenge = session.challenge
            if session.user_id != user_id:
                raise ValueError("Session user mismatch")
            if session.state is not cli.SessionState.CHALLENGE_ISSUED:
                raise ValueError("Session already submitted or not ready")
            if challenge is None or self.sessions.clock() >= challenge.expires_at:
                raise ValueError("Challenge expired or missing")
            if illumination is None or illumination.nonce != challenge.nonce:
                raise ValueError("Illumination nonce mismatch")
            if not frames or challenge_start_frame_id not in {f.frame_id for f in frames}:
                raise ValueError("Missing challenge frame boundary")
            # Claim the attempt before model/DB IO. Failures cannot be resubmitted.
            self.sessions.move(session_id, cli.SessionState.CAPTURING)
            try:
                return self._evaluate(
                    cli, session, user_id, source_ip, frames,
                    challenge_start_frame_id, illumination, template_path, calibration_path,
                )
            except Exception:
                if session.state in {
                    cli.SessionState.CAPTURING, cli.SessionState.EVIDENCE_RECEIVED,
                    cli.SessionState.EVALUATING,
                }:
                    self.sessions.move(session_id, cli.SessionState.ERROR)
                raise

    def _evaluate(self, cli, session, user_id, source_ip, frames,
                  challenge_start_frame_id, illumination, template_path, calibration_path):
        args = self.config.args(user_id, template_path, calibration_path, source_ip)
        if (args.profile != "FULL" or args.query_budget_store != "sqlite"
                or args.pad_runtime != "onnx" or not args.pad_model or not args.pad_registry):
            raise ValueError("Runtime requires FULL, SQLite and registered ONNX PAD")
        policy = cli._decision_policy_service(args)
        template = cli._template_repository(args).read(template_path, user_id=user_id)
        calibration = self._bound_calibration(cli, args, template, calibration_path)
        detector = cli.MTCNNFaceDetector(device=args.device)
        embedder = cli.FaceNetEmbedder(device=args.device)
        baseline = cli.BaselineEvidencePipeline(
            detector, embedder,
            cli.MultiFrameVerifier(template.embedding, calibration.verification_config),
            quality=cli._quality_gate(args), min_valid_frames=args.min_valid_frames,
        )
        manifest = cli.build_capture_manifest(
            session, frames, challenge_start_frame_id=challenge_start_frame_id,
        )
        from src.face_auth.application.evidence_service import verify_capture_manifest
        if not verify_capture_manifest(manifest, session, frames):
            raise ValueError("Capture manifest session/nonce/evidence binding failed")
        self.sessions.move(session.session_id, cli.SessionState.EVIDENCE_RECEIVED)
        self.sessions.move(session.session_id, cli.SessionState.EVALUATING)
        full = cli._full_pipeline(args, baseline, embedder, template.embedding).evaluate(
            frames, challenge_kind=session.challenge.kind,
            challenge_start_frame_id=challenge_start_frame_id,
            illumination_challenge=illumination, expected_nonce=session.challenge.nonce,
        )
        contributions = getattr(full, "score_contributions", None)
        if contributions is None:
            contributions = (full.adversarial,) if full.adversarial is not None else ()
        references = (
            cli.load_reference_distributions(args.decision_reference_distributions)
            if args.decision_reference_distributions else {}
        )
        result = policy.evaluate(
            profile=cli.SecurityProfile.FULL, gate_results=list(full.gate_results),
            score_contributions=tuple(contributions), references=references,
            identity=cli.AttemptIdentity(user_id, args.device_id, source_ip),
            calibration=calibration.provenance,
        )
        self.sessions.move(session.session_id, result.terminal_state)
        token = (self.tokens.issue(session.session_id)
                 if result.decision is cli.AuthDecision.ACCEPT else None)
        return {
            "session_id": session.session_id, "state": session.state.value,
            "decision": result.decision.value, "token_id": token.token_id if token else None,
            "security_profile": "FULL", "challenge": session.challenge.kind,
            "challenge_start_frame_id": manifest.challenge_start_frame_id,
            "total_frames": full.baseline.total_frames,
            "valid_face_frames": full.baseline.valid_face_frames,
            "attempt_id": manifest.attempt_id, "evidence_digest": manifest.evidence_digest,
            "calibration": calibration.provenance.to_dict(),
            "query_budget": dict(result.budget_counts),
            "query_budget_summary": {
                "used": result.budget_counts.get("account"),
                "limit": policy.budget_policy.config.max_attempts,
                "exceeded": result.budget.reason in {
                    "ATTEMPT_BUDGET_EXCEEDED", "CONSECUTIVE_STEP_UP",
                },
                "reason": result.budget.reason,
            },
            "gates": [{"gate": gate.gate, "status": gate.status.value,
                       "score": gate.score, "threshold": gate.threshold,
                       "reason_codes": list(gate.reason_codes)}
                      for gate in result.artifact_gate_results],
        }

    def consume(self, token_id, user_id, purpose, context_hash):
        with self._lock:
            self._load()
            token = self.tokens.consume(
                token_id, user_id=user_id, purpose=purpose,
                transaction_context_hash=context_hash,
            )
            return {"session_id": token.session_id, "state": "CONSUMED", "consumed": True}
