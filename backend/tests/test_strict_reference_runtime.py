"""Web strict-boundary tests using explicitly non-measured reference fixtures.

The bundle builder/verifier and calibration/policy/token code are real. Pipeline
inference and build_runtime_contract are doubles; no camera or measured FULL pass.
Test-fixture permission exists only in the test wrapper, never the web runtime.
"""
import copy
from contextlib import ExitStack
import json
import hashlib
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from .test_hc160_runtime import setup_runtime, pytestmark


@pytest.fixture
def strict_attempt(setup_runtime, tmp_path):
    from src.face_auth.domain.graded_decision import ScoreContribution
    from src.common.reproducibility import stable_json_sha256
    from src.face_auth.application.registration_calibration import _parse_artifact
    from src.face_auth.evaluation.reference_artifact import build_bundle
    from src.face_auth.evaluation.reference_guard import load_verified_reference_bundle

    runtime, cli, frames, template_path, calibration_path, _ = setup_runtime
    axes = {}
    for axis in ('margin', 'synthetic', 'adversarial'):
        axes[axis] = dict(model_version='test-model', model_sha256='a'*64,
            preprocessing_version='test-preprocess', score_version='test-score',
            settings={'fixture': True}, producer_status='confirmed',
            definition='identity.score-identity.threshold' if axis == 'margin' else 'detector_max' if axis == 'adversarial' else 'test-only-definition',
            direction='higher_is_safer' if axis == 'margin' else 'higher_is_riskier',
            range=[-2, 2] if axis == 'margin' else [0, 2] if axis == 'adversarial' else [0, 1],
            sample_unit='authentication_attempt')
    contract = dict(schema_version='full-reference-contract/1.0', backend_commit='c'*40,
                    protocol_id='test-only-protocol', axes=axes)
    samples, assignments = [], []
    for index in range(3):
        identity = dict(sample_id=f'attempt-{index}', subject_id=f'subject-{index}',
            session_id=f'session-{index}', capture_sha256=str(index)*64,
            enrollment_capture_sha256=hashlib.sha256(f'enrollment-{index}'.encode()).hexdigest())
        assignments.append(dict(**identity, split='reference'))
        samples.append(dict(**identity, label='clean', identity_score=.8, identity_threshold=.5,
            threshold_version='test-threshold', calibration_sha256='d'*64,
            blocking_gates_passed=True,
            axis_statuses=dict(margin='PASS', synthetic='SCORED', adversarial='SCORED'),
            evaluated_axes=['margin', 'synthetic', 'adversarial'],
            scores=dict(margin=.8-.5, synthetic=index/10, adversarial=index/20)))
    assignments.append(dict(sample_id='eval', subject_id='held-out', session_id='eval-session',
        capture_sha256='f'*64, enrollment_capture_sha256='e'*64, split='evaluation'))
    scores = dict(schema_version='full-reference-scores/1.0', acquisition='test_fixture',
                  source_id='test-only', samples=samples)
    splits = dict(schema_version='full-reference-splits/1.0', protocol_id='test-only-protocol',
                  assignments=assignments)
    paths = [tmp_path / name for name in ('scores.json', 'contract.json', 'splits.json')]
    artifact = _parse_artifact(json.loads(calibration_path.read_text()))
    for axis, item in contract['axes'].items():
        item['settings']['producer_dirty'] = False
        if axis == 'margin':
            item['model_version'] = artifact.model_version
            item['preprocessing_version'] = artifact.preprocessing_version
            item['settings']['runtime'] = dict(artifact.runtime)
        item['settings_sha256'] = stable_json_sha256(item['settings'])
    scores['contract'] = copy.deepcopy(contract)
    for row in scores['samples']:
        row['contract_sha256'] = stable_json_sha256(contract)
    for path, value in zip(paths, (scores, contract, splits)):
        path.write_text(json.dumps(value))
    bundle = tmp_path / 'bundle'
    build_bundle(*paths, bundle, allow_test_fixture=True)
    original_args = runtime.config.args

    def args(*values):
        result = original_args(*values)
        result.decision_reference_bundle = str(bundle)
        result.reference_scores, result.reference_contract, result.reference_splits = map(str, paths)
        result.evaluation_protocol_id = contract['protocol_id']
        return result

    runtime.config.args = args
    names = ('frame_integrity', 'quality', 'single_face', 'camera_motion', 'content_replay',
             'illumination_challenge', 'passive_pad', 'active_liveness', 'continuity', 'identity')
    observation = SimpleNamespace(
        baseline=SimpleNamespace(total_frames=6, valid_face_frames=6),
        gate_results=tuple(cli.GateResult(name, cli.GateStatus.PASS, score=1., threshold=.6)
                           for name in names),
        score_contributions=(ScoreContribution('synthetic', 0.),
                             ScoreContribution('adversarial', 0.)),
    )
    pipeline = SimpleNamespace(evaluate=lambda *a, **kw: observation)
    session, challenge = runtime.create('alice', 'LOGIN', 'context')
    illumination = runtime.illumination(challenge.nonce, 0.)

    def verified(*values, **kwargs):
        # Production callers never opt in to fixture data. Explicitly enable it
        # only here so real bundle verification can exercise a non-measured fixture.
        assert 'allow_test_fixture' not in kwargs
        return load_verified_reference_bundle(*values, **kwargs, allow_test_fixture=True)

    return SimpleNamespace(runtime=runtime, cli=cli, frames=frames, template=template_path,
        calibration=calibration_path, bundle=bundle, paths=paths, contract=contract,
        pipeline=pipeline, session=session, illumination=illumination, verified=verified)


def evaluate(attempt, *, guard=None, snapshot=None):
    cli = attempt.cli
    with ExitStack() as stack:
        stack.enter_context(patch.object(cli, 'MTCNNFaceDetector'))
        stack.enter_context(patch.object(cli, 'FaceNetEmbedder'))
        stack.enter_context(patch.object(cli, '_full_pipeline', return_value=attempt.pipeline))
        build = stack.enter_context(patch(
            'src.face_auth.evaluation.runtime_record.build_runtime_contract',
            side_effect=snapshot or (lambda pipeline, protocol: (copy.deepcopy(attempt.contract), {}))))
        check = stack.enter_context(patch(
            'src.face_auth.evaluation.reference_guard.load_verified_reference_bundle',
            side_effect=guard or attempt.verified))
        result = attempt.runtime.evaluate(attempt.session.session_id, 'alice', '127.0.0.1',
            attempt.frames, 1, attempt.illumination, attempt.template, attempt.calibration)
    return result, build, check


def test_verified_fixture_is_bound_to_same_pipeline_and_selected_calibration(strict_attempt):
    attempt = strict_attempt
    result, snapshot, guard = evaluate(attempt)
    snapshot.assert_called_once_with(attempt.pipeline, attempt.contract['protocol_id'])
    call = guard.call_args
    assert call.args[0] == str(attempt.bundle)
    assert call.kwargs['scores_path'] == str(attempt.paths[0])
    assert call.kwargs['contract_path'] == str(attempt.paths[1])
    assert call.kwargs['splits_path'] == str(attempt.paths[2])
    selected = call.kwargs['calibration']
    assert selected.artifact_id == call.kwargs['calibration_provenance'].artifact_id
    assert selected.subject_reference == 'template:' + call.kwargs['template_version']
    assert result['decision'] == 'ACCEPT'
    assert result['token_id']
    assert attempt.runtime.consume(result['token_id'], 'alice', 'LOGIN', 'context')['consumed']


@pytest.mark.parametrize('failure', [
    'missing-config', 'raw-reference', 'missing-bundle', 'references-tamper',
    'scores-tamper', 'contract-tamper', 'splits-tamper', 'runtime-mismatch',
    'snapshot-error', 'guard-error', 'calibration-changed', 'calibration-changed-in-guard',
])
def test_strict_failure_never_evaluates_policy_or_issues_token(strict_attempt, failure):
    attempt = strict_attempt
    cli, runtime = attempt.cli, attempt.runtime
    snapshot = None
    guard = None
    original_args = runtime.config.args
    if failure in ('missing-config', 'raw-reference'):
        def args(*values):
            result = original_args(*values)
            if failure == 'missing-config':
                result.reference_splits = None
            else:
                result.decision_reference_distributions = str(attempt.paths[0])
            return result
        runtime.config.args = args
    elif failure == 'missing-bundle':
        (attempt.bundle / 'artifact.json').unlink()
    elif failure.endswith('-tamper'):
        target = failure.split('-')[0]
        path = attempt.bundle / 'references.json' if target == 'references' else attempt.paths[
            {'scores': 0, 'contract': 1, 'splits': 2}[target]]
        value = json.loads(path.read_text())
        value['tampered'] = True
        path.write_text(json.dumps(value))
    elif failure == 'runtime-mismatch':
        attempt.contract['backend_commit'] = 'd' * 40
    elif failure == 'snapshot-error':
        def snapshot(*args):
            raise RuntimeError('contract snapshot failed')
    elif failure == 'guard-error':
        def guard(*args, **kwargs):
            raise RuntimeError('guard failed')
    elif failure == 'calibration-changed-in-guard':
        def guard(*args, **kwargs):
            references = attempt.verified(*args, **kwargs)
            attempt.calibration.write_text(attempt.calibration.read_text() + '\n')
            return references
    elif failure == 'calibration-changed':
        original = attempt.pipeline.evaluate
        def changed(*args, **kwargs):
            result = original(*args, **kwargs)
            attempt.calibration.write_text(attempt.calibration.read_text() + '\n')
            return result
        attempt.pipeline.evaluate = changed
    with patch.object(cli, '_decision_policy_service') as policy, \
            patch.object(runtime.tokens, 'issue') as issue:
        with pytest.raises((ValueError, RuntimeError, OSError)):
            evaluate(attempt, guard=guard, snapshot=snapshot)
    policy.return_value.evaluate.assert_not_called()
    issue.assert_not_called()
    assert attempt.session.state is cli.SessionState.ERROR
    assert runtime.store.find_token_by_session(attempt.session.session_id) is None


def test_production_web_guard_never_accepts_test_fixture(strict_attempt):
    from src.face_auth.evaluation.reference_guard import load_verified_reference_bundle
    with patch.object(strict_attempt.cli, '_decision_policy_service') as policy, \
            patch.object(strict_attempt.runtime.tokens, 'issue') as issue:
        with pytest.raises(ValueError):
            evaluate(strict_attempt, guard=load_verified_reference_bundle)
    policy.return_value.evaluate.assert_not_called()
    issue.assert_not_called()
    assert strict_attempt.session.state is strict_attempt.cli.SessionState.ERROR
