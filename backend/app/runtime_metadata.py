"""Startup-only code identity and display metadata; never decision inputs."""
from pathlib import Path
import subprocess


# ADR-005 sections 3/4 and DecisionPolicyService's FULL blocking/scoring sets.
DISPLAY_LAYERS = {
    "frame_integrity": "L0", "quality": "L0", "single_face": "L0",
    "camera_motion": "L1", "content_replay": "L1", "illumination_challenge": "L1",
    "passive_pad": "L1", "active_liveness": "L1", "continuity": "L1",
    "identity": "L2", "adversarial": "L3", "adversarial_template": "L3",
    "query_budget": "L4",
}


def gate_role(gate):
    if "role" in gate:
        return gate["role"]
    if gate["gate"] == "query_budget":
        return "ESCALATION"
    if gate["gate"] in {"identity", "adversarial", "adversarial_template"} or gate["status"] == "SCORED":
        return "SCORING"
    # Preserve the existing conservative default, including unknown gates.
    return "BLOCKING"


def repository_identity(path):
    unknown = {"commit": "unknown", "dirty": None}
    if not path:
        return unknown
    root = Path(path).resolve()
    # Do not accidentally identify a parent repo for a source archive/subfolder.
    if not (root / ".git").exists():
        return unknown
    def git(*args):
        return subprocess.run(["git", "-C", str(root), *args], check=True,
                              capture_output=True, text=True, timeout=5).stdout.strip()
    try:
        if Path(git("rev-parse", "--show-toplevel")).resolve() != root:
            return unknown
        commit = git("rev-parse", "HEAD")
        dirty = bool(git("status", "--porcelain", "--untracked-files=normal"))
        return {"commit": commit, "dirty": dirty}
    except (OSError, subprocess.SubprocessError):
        return unknown


def runtime_identity(backend_path):
    backend = repository_identity(backend_path)
    web = repository_identity(Path(__file__).resolve().parents[2])
    return {"backend_commit": backend["commit"], "backend_dirty": backend["dirty"],
            "web_commit": web["commit"], "web_dirty": web["dirty"]}


def artifact_version(identity):
    commit = identity.get("backend_commit", "unknown")
    return commit + ("-dirty" if commit != "unknown" and identity.get("backend_dirty") else "")
