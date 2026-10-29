# Sequential public-input CPU thread benchmark

Run from final auth backend with the independent Python 3.11 environment:

```sh
/Users/choihwanseok/26_HP015/hanium-local/synthetic-venv/bin/python /private/tmp/veriface-thread-benchmark.py
```

The coordinator holds an exclusive file lock and launches only one model child at a time, in fresh processes: default (10), 2, 1 Torch intra-op threads. Each process loads each model once, runs an initial six-frame warmup, then repeats the identical six-frame synthetic input three times. Three repetitions of additional real components follow sequentially.

All public frames are unmodified 512x512 skimage astronaut BGR pixels. Each JSON records their SHA-256, frame count, score values and stage timers. SBI/RetinaFace, registered PAD, cached FaceNet and packaged MTCNN are real; no model/identity doubles. Cached FaceNet is required and downloader calls are blocked. Existing model preprocessing/device/config defaults are retained, including the existing adversarial max_frames=3. No camera, reference bundle validation, enrollment, calibrated identity decision, policy, token, SQLite or live FULL approval is executed.

An artificial public anchor constructs continuity objects only. Public stills fail replay/illumination/liveness/continuity. Gate timing can take failure paths and is not a bound on real live challenge cost. The full runtime contract fingerprints actual loaded models, but this benchmark is not a measured reference source or compatibility approval.

The candidate reports contain independent cold-ish load observations and three warmed repetitions with individual, median and maximum values. The comparison file measures synthetic score differences only; identity embeddings are not stored and adversarial numerical invariance was not compared. Threadpool metadata records OpenBLAS/OpenMP counts without library paths. No thresholds, resolution or frame counts were tuned.

The system is not isolated. Preserve per-candidate load averages and hardware.json aggregate snapshots; other process names/arguments/environments are never retained. The separate hardware snapshot used read-only elevated sysctl/ps access because those APIs were denied in model child sandboxes. Apple M1 Pro, 10 physical and 10 logical cores. All auth producer snapshots in this run were f1fc9c57ca5d1721354c666ddd059d70d1efd56c, clean.

The observed 2-thread synthetic median is 4.2% lower and observed maximum 8.8% lower than default; three samples under changing load cannot establish a universal speedup, real-camera latency distribution, timeout sufficiency or attack performance. Production runtime was not changed by this benchmark.

The retained cancellation script has a post-measurement lock-directory safety correction: a unique temporary directory replaces the empty storage-root stub. The original numeric report remains unchanged. The 30-frame script already used isolated temporary state. These scripts never read private enrollment/configuration files.
