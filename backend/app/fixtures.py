from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[2]
FRONTEND_PUBLIC = ROOT / "frontend" / "public"


def load_json(relative_path: str):
    path = FRONTEND_PUBLIC / relative_path
    return json.loads(path.read_text(encoding="utf-8"))


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def session_fixture_for_scenario(session_id: str, scenario: str):
    payload = deepcopy(load_json("hc160/session-result.json"))
    payload["session_id"] = session_id
    payload["created_at"] = utc_now()
    payload["completed_at"] = utc_now()

    if scenario == "normal":
        payload["status"] = "COMPLETED"
        payload["final_decision"] = "ACCEPT"
        payload["attempt_count"] = 1
        payload["query_budget"] = {"used": 1, "limit": 3, "exceeded": False}
        for gate in payload["gates"]:
            if gate["status"] in {"FAIL", "NOT_EVALUATED"}:
                gate["status"] = "PASS"
                gate["reason_code"] = None
                gate["score"] = gate["score"] if gate["score"] else None
        return payload

    if scenario == "quality_fail":
        payload["status"] = "COMPLETED"
        payload["final_decision"] = "REJECT"
        payload["gates"][0]["status"] = "FAIL"
        payload["gates"][0]["reason_code"] = "FACE_QUALITY_LOW"
        return payload

    if scenario == "timeout":
        payload["status"] = "ERROR"
        payload["final_decision"] = "ERROR"
        payload["latency_ms"] = 3000
        payload["gates"][1]["status"] = "TIMEOUT"
        payload["gates"][1]["reason_code"] = "LIVENESS_TIMEOUT"
        return payload

    payload["status"] = "COMPLETED"
    payload["final_decision"] = "STEP_UP"
    payload["gates"][4]["status"] = "FAIL"
    payload["gates"][4]["reason_code"] = "L3_HIGH_ADV_RISK"
    payload["gates"][4]["score"] = "HIGH_RISK_BAND"
    return payload
