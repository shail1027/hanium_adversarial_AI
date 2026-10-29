"""Sequential public-image component benchmark. Never capture or evaluate policy."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
from time import perf_counter

BACKEND=Path('/Users/choihwanseok/26_HP015/hanium-local/backend-final-integration')
PYTHON='/Users/choihwanseok/26_HP015/hanium-local/synthetic-venv/bin/python'
OUTPUT=Path('/private/tmp/veriface-thread-benchmark')


def system_snapshot():
    result={'load_average':list(os.getloadavg()),'logical_cpus':os.cpu_count()}
    for label,name in [('physical_cpus','hw.physicalcpu'),('cpu_brand','machdep.cpu.brand_string')]:
        try: result[label]=subprocess.check_output(['sysctl','-n',name],text=True).strip()
        except (OSError,subprocess.CalledProcessError): result[label]='unavailable'
    # Do not retain process names, arguments, users, paths or environment values.
    try:
        text=subprocess.check_output(['ps','-A','-o','%cpu=,comm='],text=True,stderr=subprocess.DEVNULL)
        groups={name:{'count':0,'cpu_percent_sum':0.0} for name in ('python','node','other')}
        for line in text.splitlines():
            values=line.strip().split(None,1)
            if len(values)!=2: continue
            name=Path(values[1]).name.lower()
            group='python' if 'python' in name else 'node' if name=='node' else 'other'
            groups[group]['count']+=1
            groups[group]['cpu_percent_sum']+=float(values[0])
        result['process_aggregate']=groups
    except (OSError,ValueError,subprocess.CalledProcessError): result['process_aggregate']='unavailable'
    return result


def summary(values):
    return {'individual':values,'median':statistics.median(values),'max':max(values)}


def candidate(name):
    sys.path.insert(0,str(BACKEND))
    import numpy as np
    import torch
    from PIL import Image
    from skimage import data
    from types import SimpleNamespace
    from src.face_auth import cli
    from src.face_auth.evaluation.runtime_record import build_runtime_contract,producer_identity
    from src.face_auth.inference.face_detector import MTCNNFaceDetector
    from src.face_auth.inference.quality import QualityGate
    from src.face_auth.inference.verifier import FaceNetEmbedder
    from src.verification.defenses import facenet_embed
    import facenet_pytorch.models.inception_resnet_v1 as resnet_module
    report={'candidate':name,'scope':'public component smoke; no capture, reference, guard, policy, token or live FULL latency',
        'producer_before':producer_identity(),'python':platform.python_version(),'machine':platform.machine(),
        'system_before':system_snapshot(),'torch_version':torch.__version__,'torch_threads_default':torch.get_num_threads()}
    if name!='default': torch.set_num_threads(int(name))
    report['torch_threads']=torch.get_num_threads()
    report['torch_interop_threads']=torch.get_num_interop_threads()
    report['torch_parallel_info']=torch.__config__.parallel_info()
    try:
        from threadpoolctl import threadpool_info
        report['blas_pools']=[{k:v for k,v in item.items() if k!='filepath'} for item in threadpool_info()]
    except ImportError: report['blas_pools']='threadpoolctl unavailable'
    public=data.astronaut()
    bgr=np.ascontiguousarray(public[:,:,::-1])
    report['input']={'source':'skimage.data.astronaut','shape':list(bgr.shape),'dtype':str(bgr.dtype),
        'bgr_sha256':hashlib.sha256(bgr.tobytes()).hexdigest(),'frame_count':6,
        'same_unchanged_image_repeated':True,'resolution_or_frame_skipping':False}
    frames=tuple(cli.FramePacket(i,i/10.,bgr.copy()) for i in range(6))
    assets=Path('/Users/choihwanseok/26_HP015/hanium-local/synthetic-assets')
    pad=Path('/Users/choihwanseok/.codex/worktrees/final-pad-runtime/hanium-aml-defense/local_models/anti-spoof-mn3/anti-spoof-mn3.onnx')
    args=cli.build_parser().parse_args(['authenticate','--video','unused','--template','unused','--user-id','public-smoke',
        '--device','cpu','--profile','FULL','--pad-runtime','onnx','--pad-model',str(pad),
        '--pad-model-version','open-model-zoo-anti-spoof-mn3-2022.1',
        '--pad-registry',str(BACKEND/'configs/models/anti-spoof-mn3.json'),
        '--synthetic-model',str(assets/'FFc23.tar'),'--synthetic-detector-model',str(assets/'retinaface_resnet50_2020-07-20.pth'),
        '--synthetic-device','cpu','--l3-defense-score','--decision-reference-bundle','/private/tmp/unused-public-smoke'])
    seconds={}
    # Only use already-cached identity weights. A cache miss stops, never downloads.
    if not (Path('/Users/choihwanseok/.cache/torch/checkpoints/20180402-114759-vggface2.pt')).is_file():
        raise RuntimeError('cached FaceNet weights missing')
    def no_download(*args,**kwargs): raise RuntimeError('benchmark forbids downloading weights')
    resnet_module.download_url_to_file=no_download
    start=perf_counter(); detector=MTCNNFaceDetector(device='cpu')
    seconds['mtcnn_package_weights_load']=perf_counter()-start
    embedder=FaceNetEmbedder(device='cpu')
    start=perf_counter(); facenet_embed.get_model('cpu')
    seconds['facenet_cached_weights_load']=perf_counter()-start
    baseline=SimpleNamespace(embedder=embedder,detector=detector,quality=QualityGate(),min_valid_frames=args.min_valid_frames)
    # An explicit public-image anchor is used only to construct the component
    # objects; it is neither an enrollment nor a subject identity assertion.
    template=np.ones(512,dtype=np.float32)/np.sqrt(512)
    pad_factory=cli.create_pad_scorer
    def load_pad(*a,**kw):
        start=perf_counter(); result=pad_factory(*a,**kw)
        seconds['pad_registered_load']=perf_counter()-start
        return result
    cli.create_pad_scorer=load_pad
    start=perf_counter(); pipeline=cli._full_pipeline(args,baseline,embedder,template)
    seconds['full_factory_with_pad_load']=perf_counter()-start
    inspector=pipeline.synthetic_inspector
    loader=inspector.load_model
    stage=[]; emitted=[]
    def timed_loader(*a,**kw):
        start=perf_counter(); scorer=loader(*a,**kw)
        seconds['sbi_retinaface_load']=perf_counter()-start
        detect=scorer.detector.predict_jsons
        def timed_detect(*a,**kw):
            start=perf_counter(); value=detect(*a,**kw); stage.append(('retinaface',perf_counter()-start)); return value
        scorer.detector.predict_jsons=timed_detect
        starts=[]
        scorer.model.register_forward_pre_hook(lambda module,inputs:starts.append(perf_counter()))
        scorer.model.register_forward_hook(lambda module,inputs,output:stage.append(('sbi_forward',perf_counter()-starts.pop())))
        score=scorer.score
        def capture_scores(*a,**kw):
            values=score(*a,**kw); emitted.extend(values); return values
        scorer.score=capture_scores
        return scorer
    inspector.load_model=timed_loader
    runs=[]
    for index in range(4):
        stage.clear(); emitted.clear()
        start=perf_counter(); signal=inspector.evaluate(frames); elapsed=perf_counter()-start
        if not signal.evaluated: raise RuntimeError(str(signal.reason_codes))
        runs.append({'kind':'initial_warmup_with_load' if index==0 else 'warm_repeat','index':index,
            'total_seconds':elapsed,'retinaface_seconds':sum(v for k,v in stage if k=='retinaface'),
            'sbi_forward_seconds':sum(v for k,v in stage if k=='sbi_forward'),
            'frame_scores':emitted.copy(),'mean_score':signal.score})
        print(json.dumps({'candidate':name,'stage':'synthetic','run':index,'seconds':elapsed}),flush=True)
    report['synthetic_runs']=runs
    report['synthetic_warm_summary']={key:summary([r[key] for r in runs[1:]]) for key in ('total_seconds','retinaface_seconds','sbi_forward_seconds')}
    additional={k:[] for k in ('mtcnn_detect_6','facenet_embed_6','quality_6','adversarial_default_max_frames_3',
        'pad_real_rois_6','camera_motion','content_replay','illumination','head_pose_active_liveness','continuity','runtime_contract_full_real_models')}
    statuses={}
    issuer=cli.IlluminationChallengeIssuer(cli._illumination_config(args))
    import random
    illumination=issuer.issue(random.SystemRandom(),nonce='public-benchmark',issued_at_monotonic=0.,
        accessibility=cli.AccessibilityProfile(args.illumination_accessibility))
    for index in range(3):
        start=perf_counter(); faces=[detector.detect(f.image_bgr) for f in frames]; additional['mtcnn_detect_6'].append(perf_counter()-start)
        assert all(len(found)==1 for found in faces),'public image must yield one real MTCNN face'
        selected=[found[0] for found in faces]; crops=[face.crop for face in selected]
        start=perf_counter(); embeddings=embedder.embed(crops); additional['facenet_embed_6'].append(perf_counter()-start)
        start=perf_counter(); quality=[baseline.quality.evaluate(f.image_bgr,face.bbox).result for f,face in zip(frames,selected)]; additional['quality_6'].append(perf_counter()-start)
        start=perf_counter(); adv=pipeline.adversarial_inspector.evaluate(crops,embeddings); additional['adversarial_default_max_frames_3'].append(perf_counter()-start)
        assert adv.evaluated,'adversarial component unavailable'
        start=perf_counter(); values=pipeline.pad_scorer.score(crops); additional['pad_real_rois_6'].append(perf_counter()-start)
        assert len(values)==6 and all(np.isfinite(values))
        bboxes={f.frame_id:face.bbox for f,face in zip(frames,selected)}
        start=perf_counter(); result=pipeline.camera_motion_gate.evaluate(frames,bboxes); additional['camera_motion'].append(perf_counter()-start); statuses['camera_motion']=result.status.value
        start=perf_counter(); result=pipeline.content_replay_gate.evaluate(frames); additional['content_replay'].append(perf_counter()-start); statuses['content_replay']=result.status.value
        start=perf_counter(); result=pipeline.illumination_gate.evaluate(frames,illumination,challenge_start_frame_id=0,expected_nonce='public-benchmark',face_bboxes=bboxes); additional['illumination'].append(perf_counter()-start); statuses['illumination']=result.status.value
        start=perf_counter(); samples=[pipeline.liveness_estimator.estimate(f.frame_id,face) for f,face in zip(frames,selected)]; result=pipeline.liveness_gate.evaluate('HEAD_RIGHT',samples,challenge_start_frame_id=0); additional['head_pose_active_liveness'].append(perf_counter()-start); statuses['active_liveness']=result.status.value
        start=perf_counter(); result=pipeline.continuity_gate.evaluate(embeddings); additional['continuity'].append(perf_counter()-start); statuses['continuity']=result.status.value
        start=perf_counter(); contract,_=build_runtime_contract(pipeline,'public-thread-benchmark-only'); additional['runtime_contract_full_real_models'].append(perf_counter()-start)
        print(json.dumps({'candidate':name,'stage':'additional_real_components','repeat':index}),flush=True)
    report['additional_real_components']={k:summary(v) for k,v in additional.items()}
    report['public_input_gate_statuses']=statuses
    report['load_seconds']=seconds
    report['no_identity_or_model_doubles']=True
    report['pad_providers']=list(pipeline.pad_scorer.providers)
    opts=pipeline.pad_scorer.session.get_session_options()
    report['onnx_thread_options']={'intra_op_num_threads':opts.intra_op_num_threads,'inter_op_num_threads':opts.inter_op_num_threads}
    report['notes']=['no policy/threshold evaluation or authorization; artificial public anchor only',
        'repeated public still image is expected to fail live gates; all configured frames and resolution retained',
        'three warmed observations only; no claim about real-camera performance, FAR or security',
        'component timings exclude imports, capture, HTTP, guarded bundle validation and policy/SQLite/token work']
    report['producer_after']=producer_identity(); report['system_after']=system_snapshot()
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT/f'{name}.json').write_text(json.dumps(report,indent=2)+'\n')


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--candidate',choices=['default','2','1']); args=parser.parse_args()
    if args.candidate: return candidate(args.candidate)
    OUTPUT.mkdir(exist_ok=True)
    with Path('/private/tmp/veriface-thread-benchmark.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for name in ('default','2','1'):
            print(json.dumps({'stage':'candidate_start','candidate':name}),flush=True)
            subprocess.run([PYTHON,__file__,'--candidate',name],cwd=BACKEND,check=True)
        reports=[json.loads((OUTPUT/f'{name}.json').read_text()) for name in ('default','2','1')]
        baseline=reports[0]['synthetic_runs'][1]['frame_scores']
        comparison=[]
        for r in reports:
            diffs=[abs(a-b) for run in r['synthetic_runs'] for a,b in zip(run['frame_scores'],baseline)]
            comparison.append({'candidate':r['candidate'],'torch_threads':r['torch_threads'],
                'warm_seconds':r['synthetic_warm_summary'],'max_absolute_public_score_difference_vs_default_first_warm':max(diffs),
                'additional_real_components':r['additional_real_components']})
        (OUTPUT/'comparison.json').write_text(json.dumps(comparison,indent=2)+'\n')
        print(json.dumps({'stage':'complete','output':str(OUTPUT),'comparison':comparison}),flush=True)

if __name__=='__main__': main()
