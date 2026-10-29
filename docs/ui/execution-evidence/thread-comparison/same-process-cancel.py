"""One real SBI/RetinaFace run inside CaptureService's FastAPI-process worker.

ASGI TestClient: includes HTTP route/thread scheduling, excludes TCP/network.
Public astronaut JPEG transport, fake capture clock/registry/config/identity,
PAD/liveness/reference/policy/token outcome. No camera or measured FULL approval.
"""
import base64
import io
import json
import os
from pathlib import Path
import statistics
import sys
import threading
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

WEB = Path('/Users/choihwanseok/Desktop/대학교/2026_3학년/대외활동/한이음/hanium-aml-defense/.worktrees/veriface-final-web-integration')
AUTH = Path('/Users/choihwanseok/26_HP015/hanium-local/backend-final-integration')
ASSETS = Path('/Users/choihwanseok/26_HP015/hanium-local/synthetic-assets')
OUTPUT = Path('/private/tmp/veriface-same-process-measure.json')
# Scrub process-local deployment inputs before importing the module-level empty app.
for key in list(os.environ):
    if key.startswith('HC160_') or key == 'VERIFACE_QUERY_BUDGET_DB':
        del os.environ[key]
os.environ['HC160_TORCH_THREADS'] = '2'
sys.path[:0] = [str(AUTH), str(WEB)]

import torch
from PIL import Image
from skimage import data
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.tests import test_browser_protocol as transport
from src.face_auth.inference.sbi_synthetic import create_sbi_inspector

torch.set_num_threads(2)
report = {
    'status': 'running', 'transport': 'in-process ASGI TestClient; no TCP/network',
    'scope': 'actual SBI/RetinaFace in CaptureService executor; not live FULL',
    'doubles': ['capture clock and HTTP camera transport', 'registration/configuration',
                'identity/PAD/liveness/strict references/policy/token outcome'],
    'input': {'source': 'skimage.data.astronaut', 'shape': [480, 480, 3],
              'preparation': 'public RGB resized to 480x480, JPEG quality95, real server BGR decoding',
              'transport_frames': 30, 'real_model_frames': 6},
    'torch_threads': torch.get_num_threads(), 'main_pid': os.getpid(),
    'health_samples': [],
}
image = Image.fromarray(data.astronaut()).resize((480, 480))
encoded = io.BytesIO()
image.save(encoded, format='JPEG', quality=95)
transport.jpeg = lambda: base64.b64encode(encoded.getvalue()).decode()
inspector = create_sbi_inspector(ASSETS/'FFc23.tar', ASSETS/'retinaface_resnet50_2020-07-20.pth')
score_started = threading.Event()
score_finished = threading.Event()
original_loader = inspector.load_model

def load(*args):
    begin = time.perf_counter()
    scorer = original_loader(*args)
    report['checkpoint_load_seconds'] = time.perf_counter() - begin
    original_score = scorer.score
    def score(frames):
        begin = time.perf_counter()
        score_started.set()
        try:
            values = original_score(frames)
            report['actual_output_count'] = len(values)
            report['actual_outputs_finite_in_range'] = all(0 <= value <= 1 for value in values)
            return values
        finally:
            report['six_frame_inference_seconds'] = time.perf_counter() - begin
            score_finished.set()
    scorer.score = score
    return scorer
inspector.load_model = load

class Runtime(transport.Runtime):
    decision = 'ACCEPT'  # Explicit policy/token double to challenge late-result suppression.
    def evaluate(self, *args):
        report['model_worker_pid'] = os.getpid()
        report['model_worker_thread'] = threading.current_thread().name
        begin = time.perf_counter()
        contribution = inspector.evaluate(tuple(args[3][:6]))
        report['cold_load_and_six_frame_seconds'] = time.perf_counter() - begin
        if not contribution.evaluated:
            raise RuntimeError('Actual synthetic scoring failed')
        report['actual_signal_evaluated'] = True
        return super().evaluate(*args)

# Post-measurement safety correction: isolate only the worker lock directory.
state = tempfile.TemporaryDirectory(prefix='veriface-asgi-measure-', dir='/private/tmp')
config = SimpleNamespace(repo_path=str(AUTH), storage_root=state.name, user_id='measurement-only',
                         timeout_seconds=60, ready=lambda operation='authenticate': True,
                         blockers=lambda operation='authenticate': [])
runtime, clock = Runtime(), transport.Clock()
app = create_app(config, runtime, clock)
service = app.state.capture_service
# No private or temporary enrollment/DB files are read or written.
service.registry = SimpleNamespace(registered=lambda user: True,
    resolve=lambda user: (Path('/unused-measurement-template'), Path('/unused-measurement-calibration')))
report['runtime_identity'] = service.runtime_identity
try:
    with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 41000)) as client:
        client.headers['X-CSRF-Token'] = client.get('/api/face/context').json()['csrf_token']
        session = transport.capture((client, service, runtime, clock), 'authenticate')
        with ThreadPoolExecutor(max_workers=1) as requests:
            request_started = time.perf_counter()
            pending = requests.submit(client.post, '/api/face/verify', json=session)
            while not score_started.wait(.05):
                if pending.done():
                    raise RuntimeError('Inference finished before real scoring started')
                if time.perf_counter() - request_started > 55:
                    raise TimeoutError('Real scorer did not start within budget')
            report['score_began_after_request_seconds'] = time.perf_counter() - request_started
            begin = time.perf_counter()
            health = client.get('/api/health')
            report['health_samples'].append({'latency_ms': (time.perf_counter()-begin)*1000,
                                            'status': health.status_code,
                                            'during_real_score': not score_finished.is_set()})
            begin = time.perf_counter()
            cancel = client.post('/api/face/cancel', json=session)
            report['cancel_latency_ms'] = (time.perf_counter()-begin)*1000
            report['cancel_status'] = cancel.status_code
            report['cancelled'] = cancel.json() == {'cancelled': True}
            report['native_pending_after_cancel'] = not pending.done()
            for _ in range(8):
                if score_finished.wait(.1):
                    break
                begin = time.perf_counter()
                response = client.get('/api/health')
                report['health_samples'].append({'latency_ms': (time.perf_counter()-begin)*1000,
                                                'status': response.status_code,
                                                'during_real_score': not score_finished.is_set()})
            body = pending.result(timeout=65).json()
            report['verify_request_seconds'] = time.perf_counter() - request_started
            report['late_result_suppressed'] = (body['session']['final_decision'] == 'ERROR'
                                               and body['token_id'] is None)
            report['capture_state_after_result'] = service.captures[session['session_id']].state
            consume = client.post('/api/face/consume', json={
                'session_id': session['session_id'], 'token_id': 'one-use-test-token'})
            report['late_consume_status'] = consume.status_code
            report['runtime_token_consume_called'] = runtime.consumed
    values = [sample['latency_ms'] for sample in report['health_samples']]
    report['health_latency_ms'] = {'min': min(values), 'median': statistics.median(values), 'max': max(values)}
    assert report['model_worker_pid'] == report['main_pid']
    assert report['model_worker_thread'].startswith('hc160-inference')
    assert report['actual_output_count'] == 6 and report['actual_outputs_finite_in_range']
    assert report['cancelled'] and report['native_pending_after_cancel']
    assert report['late_result_suppressed'] and report['late_consume_status'] == 409
    assert report['runtime_token_consume_called'] is False
    assert any(sample['during_real_score'] for sample in report['health_samples'])
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['error_kind'] = type(error).__name__
    raise
finally:
    OUTPUT.write_text(json.dumps(report, indent=2)+'\n')
    state.cleanup()
print(json.dumps({'status': report['status'], 'output': str(OUTPUT),
                  'verify_seconds': report['verify_request_seconds'],
                  'health_max_ms': report['health_latency_ms']['max'],
                  'cancel_ms': report['cancel_latency_ms']}))
