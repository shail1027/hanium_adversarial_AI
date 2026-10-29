"""Public-input numerical comparison only; no enrollment, camera or policy."""
import json
from pathlib import Path
import sys
from time import perf_counter
import hashlib
BACKEND=Path('/Users/choihwanseok/26_HP015/hanium-local/backend-final-integration')
sys.path.insert(0,str(BACKEND))
import numpy as np
import torch
from skimage import data
import facenet_pytorch.models.inception_resnet_v1 as resnet_module
from src.face_auth.inference.cpu_runtime import cpu_execution_metadata
from src.face_auth.inference.face_detector import MTCNNFaceDetector
from src.face_auth.inference.feature_squeeze import FeatureSqueezeInspector,FeatureSqueezeConfig
from src.face_auth.inference.verifier import FaceNetEmbedder
from src.face_auth.inference.pad_adapter import create_pad_scorer
from src.face_auth.evaluation.runtime_record import producer_identity
from src.verification.defenses import facenet_embed
assert (Path('/Users/choihwanseok/.cache/torch/checkpoints/20180402-114759-vggface2.pt')).is_file()
def no_download(*a,**kw): raise RuntimeError('benchmark forbids downloading weights')
resnet_module.download_url_to_file=no_download
report={'scope':'public-input numerical smoke only; no real reference, calibration, identity authorization or attack performance',
    'producer_before':producer_identity(),'frames':6,'repetitions_per_candidate':1,
    'models':'real cached FaceNet, packaged MTCNN, registered ONNX PAD; deterministic existing adversarial default',
    'notes':['same loaded model instances, candidate10 then2; no embeddings or crops saved',
        'SBI not rerun here; prior sequential six-frame benchmark compared its output',
        'observed equality on one repeated public image does not prove general numeric invariance']}
embedder=FaceNetEmbedder(device='cpu'); detector=MTCNNFaceDetector(device='cpu'); facenet_embed.get_model('cpu')
inspector=FeatureSqueezeInspector(embedder,None,config=FeatureSqueezeConfig(defense_score_enabled=True))
pad=create_pad_scorer(runtime='onnx',model_path='/Users/choihwanseok/.codex/worktrees/final-pad-runtime/hanium-aml-defense/local_models/anti-spoof-mn3/anti-spoof-mn3.onnx',model_version='open-model-zoo-anti-spoof-mn3-2022.1',registry_path=str(BACKEND/'configs/models/anti-spoof-mn3.json'),device='cpu')
image=np.ascontiguousarray(data.astronaut()[:,:,::-1]); report['public_bgr_sha256']=hashlib.sha256(image.tobytes()).hexdigest()
baseline=None; results=[]
for threads in [10,2]:
    torch.set_num_threads(threads)
    start=perf_counter(); faces=[detector.detect(image) for _ in range(6)]
    assert all(len(found)==1 for found in faces)
    crops=[found[0].crop for found in faces]
    embeddings=np.asarray(embedder.embed(crops)); adv=inspector.evaluate(crops,list(embeddings)); pads=np.asarray(pad.score(crops))
    assert adv.evaluated and np.isfinite(embeddings).all() and np.isfinite(pads).all()
    values={'embeddings':embeddings,'adversarial':np.array([adv.score]),'pad':pads,
            'mtcnn_bbox':np.asarray([found[0].bbox for found in faces],dtype=float),
            'mtcnn_probability':np.asarray([found[0].probability for found in faces])}
    if baseline is None: baseline={k:v.copy() for k,v in values.items()}
    results.append({'threads':threads,'seconds':perf_counter()-start,'cpu_execution':cpu_execution_metadata(),
        'max_absolute_difference_vs_10':{key:float(np.max(np.abs(value-baseline[key]))) for key,value in values.items()}})
report['results']=results; report['producer_after']=producer_identity()
Path('/private/tmp/veriface-thread-accuracy.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
