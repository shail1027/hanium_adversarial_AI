# 최종 웹 strict reference 연결과 촬영 절차

이 문서가 기존 final-web-integration.md의 실행 설정을 대체한다. UI 변경 없음.
웹 브랜치 `codex/final-web-integration`, 인증 backend는
`/Users/choihwanseok/26_HP015/hanium-local/backend-final-integration`의 clean
`8cff40d9c120249e9a332c293484ed9be71dab62`로 고정한다.

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
user=os.environ['HC160_LOCAL_USER_ID']
if registry.registered(user):
    raise SystemExit('Registration exists: do not replace or fabricate a receipt')
record=OUTPUT/'collection/enrollment-record'
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
registry=Registry(os.environ['HC160_STORAGE_ROOT']); user=os.environ['HC160_LOCAL_USER_ID']
template,calibration=registry.resolve(user)
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
    '--evaluation-enrollment-record',str(OUTPUT/'collection/enrollment-record/enrollment-record.json'),
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

실제 계획한 reference cohort의 export-manifest.json attempts를 수집해
`cohort-manifest.json`(full-reference-export/1.0, acquisition=measured, 실제 source_id)을 작성한다.
원본 producer 관측값을 수정하지 않는다. 검토한 contract.json과 사전 배정된 splits.json을 함께 둔다.
각 subject의 같은-call enrollment receipt가 필요하다. 평가 subject는 별도 개인 등록/보정 자료를 사용한다.
위 코드는 현재 한 명의 private config 사용자 경로이며 cohort 여러 사람의 등록을 자동 생성하는 기능이 아니다.

```sh
cd "$BACKEND"
"$PY" -m src.face_auth.evaluation.reference_export --manifest "$COLLECTION/cohort-manifest.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/splits.json" --output "$COLLECTION/export"
"$PY" -m src.face_auth.evaluation.reference_export --verify --manifest "$COLLECTION/cohort-manifest.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/splits.json" --output "$COLLECTION/export"
"$PY" -m src.face_auth.evaluation.reference_cli build --scores "$COLLECTION/export/scores.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/splits.json" --output "$COLLECTION/bundle"
"$PY" -m src.face_auth.evaluation.reference_cli verify --scores "$COLLECTION/export/scores.json" \
 --contract "$COLLECTION/contract.json" --splits "$COLLECTION/splits.json" --output "$COLLECTION/bundle"
```

실측에는 `--allow-test-fixture`를 사용하지 않는다. 출력 디렉터리는 새 경로여야 한다.
manifest/splits 필드의 정확한 스키마는 최종 backend의 FULL_REFERENCE_EXPORT_HANDOFF.md와 reference_artifact.py를 따른다.

## 5. 독립 평가와 검증된 bundle 웹 적용

웹 폴더(`cd "$WEB"`)로 돌아온 뒤 reference를 고정하고 사전에 분리한 평가 subject/촬영으로 3번을 실행한다.
그 subject의 별도 등록/보정/receipt를 선택하고 `HELD_OUT_EVALUATION=1` 및 다음 네 artifact 경로를 지정한다.
평가 기록은 reference manifest/build에 넣지 않으며 평가 결과에 맞춰 모델/분포를 다시 조정하지 않는다.
실제 오류율/표본 목표의 충족은 사람이 별도로 판단한다. 도구 통과는 성능 입증이 아니다.

```sh
export HC160_REFERENCE_BUNDLE="$COLLECTION/bundle"
export HC160_REFERENCE_SCORES="$COLLECTION/export/scores.json"
export HC160_REFERENCE_CONTRACT="$COLLECTION/contract.json"
export HC160_REFERENCE_SPLITS="$COLLECTION/splits.json"
export HC160_REFERENCE_PROTOCOL_ID="$PROTOCOL_ID"
```

모든 검증과 독립 평가가 끝난 다음, **촬영 중이 아님을 확인하고 자신이 관리하는 8017 API만 종료**한다.
웹 작업 폴더로 돌아와 위 환경과 `scripts/final_web_runtime.py`로 새 프로세스를 시작한다.
health backend/web commit과 dirty를 확인한다. 다른 서버8001/5174/5175는 종료하지 않는다.
실제 웹 인증마다 해당 pipeline의 live contract가 bundle과 다시 비교된다. 환경 변수만 기존 프로세스에 바꾸는 것은 적용이 아니다.

## 검증 증거

최종 backend를 연결한 웹 전체: 121 passed, skip0, 기존 warning4.
정상 strict bundle 검사는 명시적인 test_fixture이며 실제 builder/guard/calibration/policy/token을 실행하지만
모델과 runtime contract 생성은 대역이다. production의 fixture 거부도 검증했다.
누락/변조/계약 불일치/검사 예외/calibration 변경 시 policy.evaluate/token.issue 미호출을 확인했다.
실제 SBI/RetinaFace와 PAD opt-in 추론은 별도 smoke이며 strict guard/다른 gate의 대역 범위는 각 테스트에 표시했다.
frontend21개/build/lint, pip check, diff check와 실제 App 역할 진입을 확인한다.
실카메라 또는 실측 FULL 승인을 보고하는 검사가 아니다.
