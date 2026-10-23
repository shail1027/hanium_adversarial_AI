"""Server-only configuration for the in-process HC160 adapter.

The demo login never selects a biometric user. This is an explicitly local,
single-operator bridge; production account identity must come from a real IdP.
"""
from dataclasses import dataclass
import math
import os
from pathlib import Path


@dataclass(frozen=True)
class ModelCliConfig:
    repo_path: str = ""
    storage_root: str = ""
    user_id: str = ""
    device_id: str = ""
    device: str = "cpu"
    query_budget_db: str = ""
    pad_model: str = ""
    pad_registry: str = ""
    threshold: str = ""
    threshold_version: str = ""
    template_key_id: str = ""
    reference_distributions: str = ""
    timeout_seconds: float = 60.0

    @classmethod
    def from_env(cls):
        return cls(
            repo_path=os.getenv("HC160_REPO_PATH", ""),
            storage_root=os.getenv("HC160_STORAGE_ROOT", ""),
            user_id=os.getenv("HC160_LOCAL_USER_ID", ""),
            device_id=os.getenv("HC160_DEVICE_ID", ""),
            device=os.getenv("HC160_DEVICE", "cpu"),
            query_budget_db=os.getenv("VERIFACE_QUERY_BUDGET_DB", ""),
            pad_model=os.getenv("HC160_PAD_MODEL", ""),
            pad_registry=os.getenv("HC160_PAD_REGISTRY", ""),
            threshold=os.getenv("HC160_THRESHOLD", ""),
            threshold_version=os.getenv("HC160_THRESHOLD_VERSION", ""),
            template_key_id=os.getenv("HC160_TEMPLATE_KEY_ID", ""),
            reference_distributions=os.getenv("HC160_REFERENCE_DISTRIBUTIONS", ""),
        )

    def missing_requirements(self):
        required = {
            "HC160_REPO_PATH": self.repo_path, "HC160_STORAGE_ROOT": self.storage_root,
            "HC160_LOCAL_USER_ID": self.user_id, "HC160_DEVICE_ID": self.device_id,
            "VERIFACE_QUERY_BUDGET_DB": self.query_budget_db,
            "HC160_PAD_MODEL": self.pad_model, "HC160_PAD_REGISTRY": self.pad_registry,
            "HC160_THRESHOLD": self.threshold, "HC160_THRESHOLD_VERSION": self.threshold_version,
            "HC160_TEMPLATE_KEY_ID": self.template_key_id,
            "HC160_TEMPLATE_KEYS": os.getenv("HC160_TEMPLATE_KEYS"),
        }
        return [key for key, value in required.items() if not value]

    def blockers(self):
        errors = self.missing_requirements()
        for name in ("repo_path", "storage_root", "query_budget_db", "pad_model", "pad_registry"):
            value = getattr(self, name)
            if value and not Path(value).is_absolute():
                errors.append(f"{name}: absolute path required")
        for name in ("repo_path", "storage_root"):
            value = getattr(self, name)
            if value and not Path(value).is_dir():
                errors.append(f"{name}: directory missing")
        for name in ("pad_model", "pad_registry", "reference_distributions"):
            value = getattr(self, name)
            if value and (not Path(value).is_absolute() or not Path(value).is_file()):
                errors.append(f"{name}: absolute file required")
        if self.query_budget_db and not Path(self.query_budget_db).parent.is_dir():
            errors.append("query_budget_db: parent directory missing")
        try:
            threshold = float(self.threshold)
            if not math.isfinite(threshold) or not -1 <= threshold <= 1:
                raise ValueError
        except ValueError:
            errors.append("HC160_THRESHOLD: configured finite threshold required")
        if self.device not in {"cpu", "cuda", "mps"}:
            errors.append("HC160_DEVICE: unsupported device")
        return errors

    def ready(self):
        return not self.blockers()

    def args(self, user_id, template_path, calibration_path, source_ip):
        from src.face_auth.cli import build_parser
        root = Path(self.repo_path)
        args = build_parser().parse_args([
            "authenticate", "--video", "browser-memory-only", "--profile", "FULL",
            "--template", str(template_path), "--registration-calibration-artifact", str(calibration_path),
            "--user-id", user_id, "--device", self.device, "--device-id", self.device_id,
            "--threshold", str(self.threshold), "--threshold-version", self.threshold_version,
            "--query-budget-store", "sqlite", "--query-budget-db", self.query_budget_db,
            "--pad-runtime", "onnx", "--pad-model", self.pad_model,
            "--pad-model-version", "open-model-zoo-anti-spoof-mn3-2022.1",
            "--pad-registry", self.pad_registry,
            "--graded-rule-table", str(root / "configs/decision/graded_decision_v1.json"),
            "--query-budget-config", str(root / "configs/decision/query_budget_v1.json"),
            "--template-audit-log", str(Path(self.storage_root) / "template-audit.jsonl"),
            *(["--source-ip", source_ip] if source_ip else []),
            *(["--decision-reference-distributions", self.reference_distributions]
              if self.reference_distributions else []),
        ])
        args.template_key_id = self.template_key_id
        return args
