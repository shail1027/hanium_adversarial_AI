# 최종 웹 strict reference 연결과 촬영 절차

이 문서가 기존 final-web-integration.md의 실행 설정을 대체한다. UI 변경 없음.
웹 브랜치 `codex/final-web-integration`, 인증 backend는
`/Users/choihwanseok/26_HP015/hanium-local/backend-final-integration`의 clean
`f1fc9c57ca5d1721354c666ddd059d70d1efd56c`로 고정한다.

## 현재 준비 상태와 경계

- 독립 App: http://127.0.0.1:5173/ ; 웹 API: http://127.0.0.1:8017 .
- 기존 private-demo.local/config.json, keys.json은 읽기만 한다. 키값/사용자값은 문서나 로그에 남기지 않는다.
- 기존 private-demo.local/storage에는 등록/receipt 없이 lock 파일만 있고 기존 DB는 read-only 점검했다. 기존 자료를 초기화/교체하지 않았다.
- 새 웹 등록 root: `/Users/choihwanseok/26_HP015/hanium-local/final-capture.local/storage`.
- 새 수집 root: `/Users/choihwanseok/26_HP015/hanium-local/final-capture.local/collection`.
- 새 시도 DB 경로: `/Users/choihwanseok/26_HP015/hanium-local/final-capture.local/query-budget.sqlite`.
  실제 시도 전에는 DB를 만들거나 초기화하지 않는다. 저장 경로는 Git 밖 0700이다.
- 최초 등록 설정은 준비됨. 현재 등록은 없다. context.ready는 **현재 동작**(미등록이면 enroll)의 준비 상태다.
- health.hc160_runtime_ready는 FULL 준비 상태이며 현재 false. bundle/scores/contract/splits/protocol이 없다.
- 웹 등록 기능에는 receipt/실측 export 수집 기능이 없다. **reference용 신규 등록은 아래 CLI 절차로 해야 한다.**
  웹에서 먼저 등록하면 그 등록에 receipt를 소급 생성할 수 없고 별도 신규 등록이 필요하다.
- 실카메라/조명/모델 성능/실측 reference/FULL 승인 검증은 아직 하지 않았다.

## strict 연결 계약

`backend/app/hc160_runtime.py`는 평가한 동일 pipeline 객체를 보관하고
`build_runtime_contract(pipeline, protocol_id)` 후 `load_verified_reference_bundle()`을 호출한다.
실제로 선택한 calibration을 선택 전 snapshot/hash로 고정하고 선택 직후, 추론 후, guard 후 재확인한다.
선택 provenance와 template_version을 전달하고 guard가 반환한 references만 정책에 전달한다.
검사 실패는 세션 ERROR이며 정책 평가/토큰 발급을 호출하지 않는다. raw reference/빈 사전/다른 bundle fallback 없음.
production에서 test_fixture를 허용하는 옵션은 없다. 공개 응답 필드를 추가하지 않았다.

설정은 `HC160_REFERENCE_BUNDLE`, `HC160_REFERENCE_SCORES`, `HC160_REFERENCE_CONTRACT`,
`HC160_REFERENCE_SPLITS`, `HC160_REFERENCE_PROTOCOL_ID` 모두 명시해야 한다.
`HC160_REFERENCE_DISTRIBUTIONS`의 raw 분포는 차단한다. enrollment에는 reference를 요구하지 않는다.
health의 readiness는 설정 파일 존재 검사이며 실측 적합성/승인 보증이 아니다. 실제 요청의 contract 검사는 추론 후 수행된다.

CLI와 웹은 같은 clean producer revision, Python3.11 synthetic-venv, CPU, SBI/RetinaFace 자산,
최종 PAD registry, quality/gate 기본값과 명시적 `--l3-defense-score`를 사용한다.
`HC160_L3_DEFENSE_SCORE=1`은 launcher에 명시되어 있다. 모드는 defense_population_variance다.
`adversarial_randomize=false`, `l3_randomized_samples=0`; randomized/smoothing 모드는 RNG 기록이 없어 guard가 거부한다.
기존 모드를 몰래 끄거나 임계값/필수축을 완화하지 않는다. 수집과 웹의 protocol ID는 동일해야 한다.
개인별 calibration ID/threshold는 개인마다 다를 수 있으나 실제 template/model/runtime binding과 validated/APPLIED 상태는 필수다.

## 1. 준비 확인 및 웹 실행

아래 공통 설정부터 실행한다. 기존 서버를 종료하지 않는다. launcher는 8017에서만 실행한다.

```sh
cd '/Users/choihwanseok/Desktop/대학교/2026_3학년/대외활동/한이음/hanium-aml-defense/.worktrees/veriface-final-web-integration'
export WEB="$PWD"
export PY=/Users/choihwanseok/26_HP015/hanium-local/synthetic-venv/bin/python
export BACKEND=/Users/choihwanseok/26_HP015/hanium-local/backend-final-integration
export COLLECTION=/Users/choihwanseok/26_HP015/hanium-local/final-capture.local/collection
# 읽기: csrf/user_label/key 등은 출력하지 않는다.
"$PY" - <<'PY'
import json, urllib.request
for endpoint in ('health', 'face/context'):
    data=json.load(urllib.request.urlopen('http://127.0.0.1:8017/api/'+endpoint))
    keys=('hc160_runtime_ready','hc160_runtime_missing','runtime_identity') if endpoint=='health' else ('registered','ready','blockers')
    print({key:data[key] for key in keys})
PY
```

서버가 실행 중이 아닐 때만:

```sh
PYTHONPATH=/private/tmp/veriface-final-web-preview-deps "$PY" scripts/final_web_runtime.py
# 별도 터미널, frontend 폴더에서
VERIFACE_API_TARGET=http://127.0.0.1:8017 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

uvicorn은 기존 별도 /private/tmp/veriface-final-web-preview-deps에 설치되어 있다.
launcher는 키 존재를 검증하지만 출력하지 않으며 backend revision/clean을 검사하고 실제 모듈을 새 프로세스에 로드한다.
기존 config의 repo/storage/DB를 수정하지 않고 이 프로세스에서만 명시적으로 분리한다.

촬영 전 사람이 동의, subject별 reference/evaluation 분리, 표본 수/평가 목표, protocol ID와 source ID를 확정해야 한다.
아래 예시의 ID를 임의 fixture로 채우지 않는다. 독립 평가 대상은 reference 대상과 중복하지 않는다.

## 2. receipt를 남기는 신규 등록 — 사람이 실행하면 카메라가 켜짐

웹에서 등록 버튼을 먼저 누르지 않는다. 아래 절차는 기존 CLI 등록을 실행한 뒤
완성된 동일 template/calibration을 웹의 기존 Registry API에 게시하는 운영 절차다.
기존 mapping이 있으면 중단하며 덮어쓰지 않는다. 출력 경로에 자료가 있으면 재사용하지 않는다.

```sh
cd "$WEB"
"$PY" - <<'PY'
import os, subprocess, sys
from scripts.final_web_runtime import configure, BACKEND, OUTPUT
configure()
from backend.app.registration_store import Registry
registry=Registry(os.environ['HC160_STORAGE_ROOT'])
user=os.environ.get('COLLECTION_USER_ID') or os.environ['HC160_LOCAL_USER_ID']
if registry.registered(user):
    raise SystemExit('Registration exists: do not replace or fabricate a receipt')
name=os.environ.get('ENROLLMENT_RECORD_NAME','enrollment-record')
if not name or name in ('.','..') or '/' in name:
    raise SystemExit('A fresh simple enrollment directory name is required')
record=OUTPUT/'collection'/name
if record.exists():
    raise SystemExit('Choose a separately reviewed new collection; existing outputs retained')
template, calibration=registry.allocate(user)
result=subprocess.run([sys.executable,'-m','src.face_auth.cli','enroll','--camera','0','--preview',
    '--device','cpu','--user-id',user,'--template-key-id',os.environ['HC160_TEMPLATE_KEY_ID'],
    '--output',str(template),'--registration-calibration-output',str(calibration),
    '--template-audit-log',str(registry.root/'template-audit.jsonl'),
    '--evaluation-record-output',str(record)],cwd=BACKEND)
if result.returncode or not (record/'enrollment-record.json').is_file():
    raise SystemExit('Enrollment/receipt incomplete; retain failed outputs and do not publish')
registry.publish(user,template,calibration)
print('Enrollment and same-call receipt published; authentication is a separate capture')
PY
```

이 CLI 게시 시 다른 촬영이 진행 중이면 안 된다. 웹을 촬영 대기 상태로 두거나 통합 API를 종료한 후 실행한다.
게시 후 웹을 새로고침하면 registered=true, FULL ready=false(reference 미준비)여야 한다.
키/템플릿/보정 내용은 출력하거나 Git에 추가하지 않는다.

## 3. 별도의 reference 인증 촬영 — 사람이 실행하면 카메라가 켜짐

먼저 실제 확정한 값을 환경에 넣는다. 아래 shell의 `:?` 검사는 미설정이면 중단한다.
ATTEMPT_NAME은 매 시도마다 새 이름이다. 처음 기록된 contract는 관측값이며 검토 없이 승인한 계약으로 취급하지 않는다.

```sh
cd "$WEB"
: "${PROTOCOL_ID:?Set the reviewed protocol ID}"
: "${COLLECTION_ID:?Set the real collection source ID}"
: "${ATTEMPT_NAME:?Set a new attempt directory name}"
export PROTOCOL_ID COLLECTION_ID ATTEMPT_NAME
"$PY" - <<'PY'
import os, subprocess, sys
from scripts.final_web_runtime import configure, BACKEND, OUTPUT
configure()
from backend.app.registration_store import Registry
registry=Registry(os.environ['HC160_STORAGE_ROOT']); user=os.environ.get('COLLECTION_USER_ID') or os.environ['HC160_LOCAL_USER_ID']
if os.environ.get('HELD_OUT_EVALUATION') == '1' and not all(
        os.environ.get(key) for key in ('COLLECTION_USER_ID','ENROLLMENT_RECORD_NAME')):
    raise SystemExit('Held-out evaluation requires explicit subject and own enrollment receipt')
template,calibration=registry.resolve(user)
enrollment_name=os.environ.get('ENROLLMENT_RECORD_NAME','enrollment-record')
if not enrollment_name or enrollment_name in ('.','..') or '/' in enrollment_name:
    raise SystemExit('A simple enrollment directory name is required')
name=os.environ['ATTEMPT_NAME']
if not name or name in ('.','..') or '/' in name:
    raise SystemExit('A fresh simple attempt directory name is required')
record=OUTPUT/'collection'/name
if record.exists(): raise SystemExit('Attempt output exists; never overwrite')
args=[sys.executable,'-m','src.face_auth.cli','authenticate','--camera','0','--preview',
    '--device','cpu','--profile','FULL','--user-id',user,
    '--device-id',os.environ['HC160_DEVICE_ID'],'--source-ip','127.0.0.1',
    '--template',str(template),'--registration-calibration-artifact',str(calibration),
    '--template-audit-log',str(registry.root/'template-audit.jsonl'),
    '--query-budget-db',os.environ['VERIFACE_QUERY_BUDGET_DB'],
    '--pad-runtime','onnx','--pad-model',os.environ['HC160_PAD_MODEL'],
    '--pad-registry',os.environ['HC160_PAD_REGISTRY'],
    '--pad-model-version','open-model-zoo-anti-spoof-mn3-2022.1',
    '--synthetic-model',os.environ['HC160_SYNTHETIC_MODEL'],
    '--synthetic-detector-model',os.environ['HC160_SYNTHETIC_DETECTOR_MODEL'],
    '--synthetic-device','cpu','--l3-defense-score',
    '--evaluation-record-output',str(record),
    '--evaluation-enrollment-record',str(OUTPUT/'collection'/enrollment_name/'enrollment-record.json'),
    '--evaluation-protocol-id',os.environ['PROTOCOL_ID'],
    '--evaluation-source-id',os.environ['COLLECTION_ID'],'--evaluation-clean-confirmed']
# Held-out evaluation only: add all strict bundle flags below, never raw distributions.
if os.environ.get('HELD_OUT_EVALUATION') == '1':
    for flag,env in [('--decision-reference-bundle','HC160_REFERENCE_BUNDLE'),
                     ('--reference-scores','HC160_REFERENCE_SCORES'),
                     ('--reference-contract','HC160_REFERENCE_CONTRACT'),
                     ('--reference-splits','HC160_REFERENCE_SPLITS')]:
        args.extend([flag,os.environ[env]])
raise SystemExit(subprocess.run(args,cwd=BACKEND).returncode)
PY
```

`--evaluation-clean-confirmed`는 수집자가 실제 clean 출처를 확인한 경우에만 사용한다. 확인되지 않은 시도에는 제거하고 reference에 편입하지 않는다.
현재 reference 없음에 따른 STEP_UP/종료코드2를 성공으로 바꾸지 않는다. 실패/불완전 기록도 유지한다.
질의 예산/연속 STEP_UP 제한이 적용된다. 차단되면 DB를 초기화하거나 기록을 지워 수집을 계속하지 않는다.

## 4. export / build / verify

검토한 contract.json과 사전 배정표를 준비한다. `inventory.json`에는
schema_version=`full-reference-cohort/1.0`, 실제 protocol_id/source_id, acquisition=`measured`,
assignments 배열을 기록한다. 각 assignment 필드는 `manifest`(실제 attempt의 export-manifest.json 경로),
`subject_id`, `label`, `split`(reference/evaluation)이다. 원본 producer 관측값이나 hash를 손으로 바꾸지 않는다.
`reference_cohort`가 원본 기록의 연결/분포 적격성과 전체 split을 기존 exporter로 검증하고
`cohort/cohort-manifest.json`, `cohort/splits.json`, `cohort/cohort-report.json`을 만든다.
불완전한 reference 시도를 조용히 제외하지 않으며, 기존 출력 경로는 덮어쓰지 않는다.
각 subject의 같은-call enrollment receipt와 실제 개인별 calibration이 필요하다.
처음 bundle을 만들기 전에도 평가용 subject의 독립 등록/촬영을 2·3번으로 기록하되
`HELD_OUT_EVALUATION`을 설정하지 않아 bundle 없는 STEP_UP 기록을 얻는다.
그 실제 기록의 식별/증거만 evaluation inventory에 넣는다. 존재하지 않는 미래 시도/hash를 만들지 않는다.
bundle 고정 뒤 별도 strict 평가 촬영은 5번대로 수행한다.

```sh
cd "$BACKEND"
"$PY" -m src.face_auth.evaluation.reference_cohort --inventory "$COLLECTION/inventory.json" \
 --contract "$COLLECTION/contract.json" --output "$COLLECTION/cohort"
"$PY" -m src.face_auth.evaluation.reference_export --manifest "$COLLECTION/cohort/cohort-manifest.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/cohort/splits.json" --output "$COLLECTION/export"
"$PY" -m src.face_auth.evaluation.reference_export --verify --manifest "$COLLECTION/cohort/cohort-manifest.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/cohort/splits.json" --output "$COLLECTION/export"
"$PY" -m src.face_auth.evaluation.reference_cli build --scores "$COLLECTION/export/scores.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/cohort/splits.json" --output "$COLLECTION/bundle"
"$PY" -m src.face_auth.evaluation.reference_cli verify --scores "$COLLECTION/export/scores.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/cohort/splits.json" --output "$COLLECTION/bundle"
```

실측에는 `--allow-test-fixture`를 사용하지 않는다. 출력 디렉터리는 새 경로여야 한다.
manifest/splits 필드의 정확한 스키마는 최종 backend의 FULL_REFERENCE_EXPORT_HANDOFF.md와 reference_artifact.py를 따른다.

## 5. 독립 평가와 검증된 bundle 웹 적용

웹 폴더(`cd "$WEB"`)로 돌아온 뒤 reference를 고정하고 사전에 분리한 평가 subject/촬영으로 3번을 실행한다.
먼저 `COLLECTION_USER_ID`를 사전 배정된 별도 평가 subject ID로, `ENROLLMENT_RECORD_NAME`을 bundle 생성 전 2번에서 만든 그 subject의 등록 기록 디렉터리명으로 export한다.
이미 등록한 평가 subject의 template/calibration/receipt를 그대로 선택한다. 2번을 다시 실행하거나 기존 mapping을 덮어쓰지 않는다.
3번은 같은 두 환경을 사용해 그 subject의 Registry pair/receipt를 선택한다. 두 변수가 없으면 held-out 촬영은 중단한다.
이 ID 지정 자체가 subject 독립성의 증거는 아니며 cohort/splits 검증이 필요하다. 이후 `HELD_OUT_EVALUATION=1` 및 다음 네 artifact 경로를 지정한다.
평가 기록은 reference manifest/build에 넣지 않으며 평가 결과에 맞춰 모델/분포를 다시 조정하지 않는다.
실제 오류율/표본 목표의 충족은 사람이 별도로 판단한다. 도구 통과는 성능 입증이 아니다.

```sh
export HC160_REFERENCE_BUNDLE="$COLLECTION/bundle"
export HC160_REFERENCE_SCORES="$COLLECTION/export/scores.json"
export HC160_REFERENCE_CONTRACT="$COLLECTION/contract.json"
export HC160_REFERENCE_SPLITS="$COLLECTION/cohort/splits.json"
export HC160_REFERENCE_PROTOCOL_ID="$PROTOCOL_ID"
```

모든 검증과 독립 평가가 끝난 다음, **촬영 중이 아님을 확인하고 자신이 관리하는 8017 API만 종료**한다.
웹 작업 폴더로 돌아와 위 환경과 `scripts/final_web_runtime.py`로 새 프로세스를 시작한다.
health backend/web commit과 dirty를 확인한다. 다른 서버8001/5174/5175는 종료하지 않는다.
실제 웹 인증마다 해당 pipeline의 live contract가 bundle과 다시 비교된다. 환경 변수만 기존 프로세스에 바꾸는 것은 적용이 아니다.

## 검증 증거

최종 backend를 연결한 웹 전체: 129 passed, skip0, 기존 warning4.
정상 strict bundle 검사는 명시적인 test_fixture이며 실제 builder/guard/calibration/policy/token을 실행하지만
모델과 runtime contract 생성은 대역이다. production의 fixture 거부도 검증했다.
누락/변조/계약 불일치/검사 예외/calibration 변경 시 policy.evaluate/token.issue 미호출을 확인했다.
실제 SBI/RetinaFace와 PAD opt-in 추론은 별도 smoke이며 strict guard/다른 gate의 대역 범위는 각 테스트에 표시했다.
frontend21개/build/lint, pip check, diff check와 실제 App 역할 진입을 확인한다.
실카메라 또는 실측 FULL 승인을 보고하는 검사가 아니다.

## 실행 제한과 실패 처리 점검

127.0.0.1은 이 실행 컴퓨터의 브라우저 전용이다. 휴대폰 주소가 아니다.
360/390/430px 검사는 데스크톱 브라우저 viewport 검사이며 실제 휴대폰/무선망 검증이 아니다.
외부 터널, 공개 배포, 0.0.0.0 바인딩은 제공하지 않는다.

브라우저의 90초 제한은 카메라 권한 대기부터 촬영·verify·consume 응답까지 전체 attempt에 적용된다.
서버 촬영 업로드는 start부터 기존30초를 유지한다. 그 안에 verify가 접수되면 추론 단계에 기존60초 예산을 부여한다.
취소/상태 확인과 결과 게시가 동일한 evaluation deadline을 사용하며, 촬영 기한을 추론 완료 기한으로 혼용하지 않는다.
Future의 기존60초 대기와 브라우저 전체90초도 유지한다. 어느 제한도 늘리지 않는다.
실제 모델 실행이 추론 예산을 넘으면 오류로 종료되며 자동 재시도/timeout 연장은 없다.

취소/timeout은 클라이언트 대기와 서버 결과 수용을 종료하지만 실행 중인 Python/native CPU 스레드를 강제로 종료하지 못한다.
진행 중 추론이 끝날 때까지 inference slot이 점유되며 새 추론은 빠르게 거부한다.
네이티브 runtime은 늦게 내부 정책/토큰 생성까지 마칠 수 있으나 웹에서 그 결과/토큰을 공개·소비하지 않는다.
CaptureService.close가 호출된 뒤에는 결과 수용을 무효화한다. Uvicorn graceful shutdown은 진행 중 HTTP 요청을 먼저 기다릴 수 있으므로 SIGINT 자체를 촬영 취소로 해석하지 않는다.
Python 프로세스는 실행 중 native thread가 끝날 때까지 남을 수 있다. 서버 갱신 전 촬영 종료 확인이 필요하다.
consume은 다른 추론이 slot을 점유하면 기다리며 capture lock을 막지 않고 INFERENCE_BUSY로 거부한다.
소비 응답 유실/취소는 송금 완료로 추정하지 않는다. 현재 실제 금융 API는 연결돼 있지 않다.

## 공개 입력 구성요소 시간 측정 (2026-10-30)

현재 launcher와 같은 기본 Torch10 threads, Python3.11.7/arm64/Torch2.2.2/CPU.
공개 astronaut512×512 BGR 동일이미지6프레임. 각 값1회 관측이며 파일 캐시가 준비됐을 수 있다.

| 구성요소 | 첫 실행(초) | 같은 인스턴스 반복(초) |
|---|---:|---:|
| 실제 SBI+RetinaFace checkpoint검사/로드 | 1.743 | — |
| synthetic6프레임 전체 | 49.508 | 51.312 |
| 그중 RetinaFace 검출 | 31.599 | 36.882 |
| 그중 SBI forward | 16.034 | 14.398 |
| 실제 PAD ONNX 로드 | 0.093 | — |
| PAD 공개RGB ROI6개 전처리/추론 | 0.057 | 0.046 |
| runtime contract fingerprint | 0.236 | 0.257 |

fingerprint는 실제 SBI/RetinaFace와 **tiny identity/MTCNN 대역**을 사용했다.
실제 FaceNet/MTCNN fingerprint, identity/adversarial 추론, 전체 gate, 카메라/네트워크/guard 시간은 제외했다.
따라서 전체 실사용 인증 지연이 아니다. 6프레임 구성요소만 약50초를 사용하므로
전체 identity/adversarial/gate까지 기존60초 추론 예산 안에 끝나는지는 미완료다. timeout/프레임수/보안gate를 완화하지 않았다.
2threads 별도 비교값 synthetic34.186/26.309초도 기록했지만 실제 서버 thread설정은 변경하지 않았다.
같은 HTTP 프로세스의 health/cancel은 pending추론 대역으로 응답성을 검증했다.
실제 모델을 별도프로세스에서 실행하면서 기존API health30회는 모두200(중앙7.193ms/최대103.434ms)였으나
이는 CPU경합 측정일 뿐 같은 프로세스 실제 전체모델의 이벤트루프 측정을 대신하지 않는다.
측정 시 backend는 다른 세션의 작업으로 dirty였고 이를 그대로 기록했다. 측정 contract는 strict 승인 자료가 아니다.

백엔드 담당의 후속 handoff를 읽기 전용으로 확인했다: clean `f1fc9c57ca5d1721354c666ddd059d70d1efd56c`.
변경은 cohort assembler·관련 테스트·문서이며 recorder/runtime/strict guard API는 그대로다.
launcher pin과 cohort 명령을 이 revision으로 맞췄다. 이전 producer revision의 실측 분포를 호환으로 간주하지 않는다.
현재 실측 분포가 없으므로 새 촬영은 이 clean revision에서 시작해야 한다.

이번 실행 경로 점검에서 촬영/추론 만료 기준의 불일치, 종료 후 늦은 결과 게시, 다른 추론 중 consume 잠금 대기를 재현하고 수정했다.
추가 HTTP 회귀는 native 작업이 끝나기 전에 health/cancel이 응답하고, 늦은 ACCEPT/등록 결과와 token이 수용되지 않음을 확인한다.
브라우저90초 검사는 실제90초 경과를 기다리는 대신 등록된90초 타이머 callback을 대역으로 실행한다.
실제 App의 pagehide/취소/네트워크실패/consume응답유실과 늦은ACCEPT를 검증하며 카메라와 인증API는 대역이다.
측정 재현 스크립트와 원본 수치는 `execution-evidence/`에 보존했다.

추가 브라우저 실행의 일반 모드는 실제 App에서 전체 인증/실패/취소 회귀를 통과했다.
reduced-motion 촬영 재실행은 시스템 부하에서 프레임 부족으로 차단되어 완료하지 못했다.
이는 실제 RAF/전송 대역의 wall-clock 검사이며, guard나 timeout을 완화하지 않았다.
카메라/API는 대역이고 Chrome headless GPU 비활성 옵션은 테스트 프로세스에만 적용했다.
서버의 실제3000ms/80프레임 계획과 일치하도록 브라우저 fixture를 맞췄고 제품 촬영 설정은 변경하지 않았다.
