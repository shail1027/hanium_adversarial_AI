"""Explicit local launch: preserve private inputs; never start capture by default.

Use --backend-cli followed by existing CLI arguments only when the operator is
ready to capture. Reference settings are explicit environment inputs, never defaults.
"""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys

LOCAL = Path('/Users/choihwanseok/26_HP015/hanium-local')
WEB = Path(__file__).resolve().parents[1]
BACKEND = LOCAL / 'backend-final-integration'
PRIVATE = LOCAL / 'private-demo.local'
OUTPUT = LOCAL / 'final-capture.local'
EXPECTED_BACKEND = 'e486fa72ae87fa70909f888546a6d15ba60960e2'
REFERENCE_ENV = (
    'HC160_REFERENCE_BUNDLE', 'HC160_REFERENCE_SCORES', 'HC160_REFERENCE_CONTRACT',
    'HC160_REFERENCE_SPLITS', 'HC160_REFERENCE_PROTOCOL_ID',
)


def configure():
    os.umask(0o077)
    commit = subprocess.check_output(['git', '-C', str(BACKEND), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(BACKEND), 'status', '--porcelain'], text=True).strip()
    if commit != EXPECTED_BACKEND or dirty:
        raise SystemExit('Expected clean final backend revision; review compatibility before changing it')
    references = {key: os.environ[key] for key in REFERENCE_ENV if key in os.environ}
    for key in list(os.environ):
        if key.startswith('HC160_') or key == 'VERIFACE_QUERY_BUDGET_DB':
            del os.environ[key]
    os.environ.update(json.loads((PRIVATE / 'config.json').read_text()))
    os.environ['HC160_TEMPLATE_KEYS'] = (PRIVATE / 'keys.json').read_text()
    os.environ.update({
        'HC160_REPO_PATH': str(BACKEND),
        'HC160_STORAGE_ROOT': str(OUTPUT / 'storage'),
        'VERIFACE_QUERY_BUDGET_DB': str(OUTPUT / 'query-budget.sqlite'),
        'HC160_PAD_REGISTRY': str(BACKEND / 'configs/models/anti-spoof-mn3.json'),
        'HC160_SYNTHETIC_MODEL': str(LOCAL / 'synthetic-assets/FFc23.tar'),
        'HC160_SYNTHETIC_DETECTOR_MODEL': str(LOCAL / 'synthetic-assets/retinaface_resnet50_2020-07-20.pth'),
        'HC160_SYNTHETIC_DEVICE': 'cpu',
        'HC160_DEVICE': 'cpu',
        'HC160_TORCH_THREADS': '2',
        'HC160_L3_DEFENSE_SCORE': '1',
        **references,
    })
    for path in (OUTPUT, OUTPUT / 'storage', OUTPUT / 'collection'):
        path.mkdir(mode=0o700, exist_ok=True)
    sys.path.insert(0, str(BACKEND))
    sys.path.insert(0, str(WEB))
    # Validate key availability without printing it or opening an enrollment.
    from src.face_auth.adapters.template_keys import EnvironmentTemplateKeyProvider
    EnvironmentTemplateKeyProvider().get_key(os.environ['HC160_TEMPLATE_KEY_ID'])


def main():
    configure()
    if sys.argv[1:2] == ['--backend-cli']:
        os.chdir(BACKEND)
        sys.argv = ['src.face_auth.cli', *sys.argv[2:]]
        runpy.run_module('src.face_auth.cli', run_name='__main__')
        return
    if sys.argv[1:]:
        raise SystemExit('Use no arguments for web API, or --backend-cli followed by CLI arguments')
    os.chdir(WEB)
    from backend.app.model_adapter import ModelCliConfig
    from backend.app.hc160_runtime import HC160Runtime
    from backend.app.main import create_app
    import uvicorn
    config = ModelCliConfig.from_env()
    if config.blockers('enroll'):
        raise SystemExit('Enrollment configuration incomplete')
    runtime = HC160Runtime(config)
    runtime._load()  # Load the pinned module in this new process, not just its path.
    uvicorn.run(create_app(config, runtime), host='127.0.0.1', port=8017,
                workers=1, proxy_headers=False, log_level='info')


if __name__ == '__main__':
    main()
