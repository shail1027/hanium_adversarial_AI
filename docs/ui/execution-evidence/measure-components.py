"""Public-image component timing; tiny identity doubles, no live capture/approval."""
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from time import perf_counter
from types import SimpleNamespace

BACKEND = Path('/Users/choihwanseok/26_HP015/hanium-local/backend-final-integration')
sys.path.insert(0, str(BACKEND))
import numpy as np
from PIL import Image
from skimage import data
import torch
from src.face_auth import cli
from src.face_auth.evaluation.runtime_record import build_runtime_contract, producer_identity
from src.face_auth.inference.face_detector import MTCNNFaceDetector
from src.face_auth.inference.quality import QualityGate
from src.face_auth.inference.verifier import FaceNetEmbedder
from src.verification.defenses import facenet_embed

assets = Path('/Users/choihwanseok/26_HP015/hanium-local/synthetic-assets')
pad = Path('/Users/choihwanseok/.codex/worktrees/final-pad-runtime/hanium-aml-defense/local_models/anti-spoof-mn3/anti-spoof-mn3.onnx')
report = {'scope': 'default Torch thread count; component timing only, not live FULL latency or performance',
    'backend': str(BACKEND), 'producer_before': producer_identity(),
    'python': platform.python_version(), 'machine': platform.machine(), 'torch': torch.__version__,
    'torch_threads_before': torch.get_num_threads(), 'torch_threads_measured': torch.get_num_threads(),
    'input': 'six repeated public skimage.data.astronaut 512x512 BGR frames; PAD uses whole public RGB as ROI',
    'doubles': ['tiny torch.nn.Linear identity model and MTCNN state for fingerprint only',
                'no identity inference, adversarial inference, active gates, camera, guard, policy or token issuance'],
    'seconds': {}, 'notes': ['imports and public image decoding excluded from component timers',
        'first/cached timings are one observation each, no latency distribution; OS file cache may already be warm']}
args = cli.build_parser().parse_args(['authenticate', '--video', 'unused', '--template', 'unused',
    '--user-id', 'timing-public-input', '--device', 'cpu', '--profile', 'FULL',
    '--pad-runtime', 'onnx', '--pad-model', str(pad),
    '--pad-model-version', 'open-model-zoo-anti-spoof-mn3-2022.1',
    '--pad-registry', str(BACKEND/'configs/models/anti-spoof-mn3.json'),
    '--synthetic-model', str(assets/'FFc23.tar'),
    '--synthetic-detector-model', str(assets/'retinaface_resnet50_2020-07-20.pth'),
    '--synthetic-device', 'cpu', '--l3-defense-score',
    '--decision-reference-bundle', '/private/tmp/unused-component-timing-not-a-bundle'])
# Same supported runtime types, but tiny identity state deliberately cannot attest
# actual FaceNet/MTCNN latency or fingerprint cost. No model download is triggered.
embedder = FaceNetEmbedder(device='cpu')
detector = MTCNNFaceDetector.__new__(MTCNNFaceDetector)
detector.image_size = 160
detector._detector = torch.nn.Linear(2,2)
detector._detector.device = 'cpu'
for key, value in dict(min_face_size=20, thresholds=[.6,.7,.7], factor=.709,
                       post_process=True, keep_all=True).items():
    setattr(detector._detector,key,value)
facenet_embed._model, facenet_embed._device = torch.nn.Linear(2,2), 'cpu'
baseline = SimpleNamespace(embedder=embedder, detector=detector, quality=QualityGate(), min_valid_frames=args.min_valid_frames)
factory = cli.create_pad_scorer

def timed_pad(*a, **kw):
    started = perf_counter()
    result = factory(*a, **kw)
    report['seconds']['pad_load_registered_onnx'] = perf_counter()-started
    return result
cli.create_pad_scorer = timed_pad
started=perf_counter()
pipeline=cli._full_pipeline(args,baseline,embedder,np.array([1.,0.],dtype=np.float32))
report['seconds']['full_factory_including_pad_load_no_identity_load'] = perf_counter()-started
rgb=data.astronaut()
frames=tuple(cli.FramePacket(i,i/10.,np.ascontiguousarray(rgb[:,:,::-1])) for i in range(6))
inspector=pipeline.synthetic_inspector
loader=inspector.load_model
split_times=[]

def timed_load(*a, **kw):
    started=perf_counter()
    scorer=loader(*a,**kw)
    report['seconds']['sbi_retinaface_loader_including_checkpoint_checks'] = perf_counter()-started
    detect=scorer.detector.predict_jsons
    def timed_detect(*x,**y):
        start=perf_counter(); result=detect(*x,**y)
        split_times.append(('retinaface',perf_counter()-start))
        return result
    scorer.detector.predict_jsons=timed_detect
    starts=[]
    scorer.model.register_forward_pre_hook(lambda module, inputs: starts.append(perf_counter()))
    scorer.model.register_forward_hook(lambda module, inputs, output: split_times.append(('sbi_forward',perf_counter()-starts.pop())))
    return scorer
inspector.load_model=timed_load
for name in ('first','cached'):
    split_times.clear()
    started=perf_counter(); signal=inspector.evaluate(frames)
    report['seconds'][f'synthetic_{name}_six_frames_total']=perf_counter()-started
    assert signal.evaluated,signal.reason_codes
    report[f'synthetic_{name}_finite']=bool(np.isfinite(signal.score))
    for component in ('retinaface','sbi_forward'):
        report['seconds'][f'{component}_{name}_six_frames']=sum(elapsed for key,elapsed in split_times if key==component)
for name in ('first','cached'):
    started=perf_counter(); values=pipeline.pad_scorer.score([Image.fromarray(rgb,'RGB')]*6)
    report['seconds'][f'pad_{name}_six_rois_preprocess_and_infer']=perf_counter()-started
    assert len(values)==6 and all(np.isfinite(values))
report['pad_providers']=list(pipeline.pad_scorer.providers)
for name in ('first','cached'):
    started=perf_counter(); contract,docs=build_runtime_contract(pipeline,'component-timing-public-input-only')
    report['seconds'][f'build_runtime_contract_{name}_real_sbi_retinaface_tiny_identity']=perf_counter()-started
    report['contract_producer_dirty']=contract['axes']['margin']['settings']['producer_dirty']
report['producer_after']=producer_identity()
Path('/private/tmp/veriface-model-timing-default.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
