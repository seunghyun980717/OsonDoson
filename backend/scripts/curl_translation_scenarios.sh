#!/usr/bin/env bash

set -euo pipefail

BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://localhost:8080}"
AUDIO_FILE="${AUDIO_FILE:-/Users/joonwan/S14P31E104/backend/test-client/sample.wav}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

pretty_print_body() {
  local body_file="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY' "$body_file"
import json
import pathlib
import sys

body = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()
if not body:
    print("<empty body>")
    raise SystemExit(0)

try:
    parsed = json.loads(body)
except json.JSONDecodeError:
    print(body)
else:
    print(json.dumps(parsed, ensure_ascii=False, indent=2))
PY
  else
    cat "$body_file"
  fi
}

format_ms_from_seconds() {
  local seconds="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY' "$seconds"
import sys

seconds = float(sys.argv[1])
print(f"{seconds * 1000:.1f} ms")
PY
  else
    echo "${seconds}s"
  fi
}

run_json_scenario() {
  local name="$1"
  local method="$2"
  local path="$3"
  local json_file="$4"
  local request_description="$5"
  local expected_response_description="$6"

  local body_file="$WORK_DIR/${name}.body"
  local curl_meta
  local status
  local elapsed_seconds

  echo
  echo "============================================================"
  echo "Scenario: $name"
  echo "Request : $method $BACKEND_BASE_URL$path"
  echo "설명    : $request_description"
  echo "예상응답: $expected_response_description"
  echo "============================================================"

  curl_meta="$(
    curl -sS \
      -o "$body_file" \
      -w "%{http_code} %{time_total}" \
      -X "$method" \
      -H "Content-Type: application/json" \
      --data "@$json_file" \
      "$BACKEND_BASE_URL$path"
  )"

  status="${curl_meta%% *}"
  elapsed_seconds="${curl_meta#* }"

  echo "HTTP $status"
  echo "응답시간: $(format_ms_from_seconds "$elapsed_seconds")"
  pretty_print_body "$body_file"
}

run_multipart_scenario() {
  local name="$1"
  local path="$2"
  local file_path="$3"
  local request_description="$4"
  local expected_response_description="$5"

  local body_file="$WORK_DIR/${name}.body"
  local curl_meta
  local status
  local elapsed_seconds

  echo
  echo "============================================================"
  echo "Scenario: $name"
  echo "Request : POST $BACKEND_BASE_URL$path"
  echo "File    : $file_path"
  echo "설명    : $request_description"
  echo "예상응답: $expected_response_description"
  echo "============================================================"

  curl_meta="$(
    curl -sS \
      -o "$body_file" \
      -w "%{http_code} %{time_total}" \
      -X POST \
      -F "file=@$file_path" \
      "$BACKEND_BASE_URL$path"
  )"

  status="${curl_meta%% *}"
  elapsed_seconds="${curl_meta#* }"

  echo "HTTP $status"
  echo "응답시간: $(format_ms_from_seconds "$elapsed_seconds")"
  pretty_print_body "$body_file"
}

run_multipart_without_file_scenario() {
  local name="$1"
  local path="$2"
  local request_description="$3"
  local expected_response_description="$4"

  local body_file="$WORK_DIR/${name}.body"
  local curl_meta
  local status
  local elapsed_seconds

  echo
  echo "============================================================"
  echo "Scenario: $name"
  echo "Request : POST $BACKEND_BASE_URL$path"
  echo "설명    : $request_description"
  echo "예상응답: $expected_response_description"
  echo "============================================================"

  curl_meta="$(
    curl -sS \
      -o "$body_file" \
      -w "%{http_code} %{time_total}" \
      -X POST \
      -F "dummy=value" \
      "$BACKEND_BASE_URL$path"
  )"

  status="${curl_meta%% *}"
  elapsed_seconds="${curl_meta#* }"

  echo "HTTP $status"
  echo "응답시간: $(format_ms_from_seconds "$elapsed_seconds")"
  pretty_print_body "$body_file"
}

cat > "$WORK_DIR/sign-to-speech-success.json" <<'JSON'
{
  "type": "signer_keypoints",
  "frames": [
    {
      "poseLandmarks": [
        { "x": 0.11, "y": 0.22, "z": 0.0, "visibility": 0.98 }
      ],
      "leftHandLandmarks": [],
      "rightHandLandmarks": [],
      "faceLandmarks": [],
      "videoWidth": 1280,
      "videoHeight": 720
    }
  ]
}
JSON

cat > "$WORK_DIR/sign-to-speech-validation-error.json" <<'JSON'
{
  "type": "signer_keypoints",
  "frames": []
}
JSON

cat > "$WORK_DIR/text-to-sign-success.json" <<'JSON'
{
  "text": "통장 재발급을 도와주세요."
}
JSON

cat > "$WORK_DIR/text-to-sign-validation-error.json" <<'JSON'
{
  "text": "   "
}
JSON

cat > "$WORK_DIR/glosses-to-speech-success.json" <<'JSON'
{
  "glosses": ["통장", "재발급", "부탁"]
}
JSON

cat > "$WORK_DIR/glosses-to-speech-validation-error.json" <<'JSON'
{
  "glosses": []
}
JSON

cat > "$WORK_DIR/glosses-to-speech-fastapi-error.json" <<'JSON'
{
  "glosses": [" ", "   "]
}
JSON

cat > "$WORK_DIR/gloss-recommend-success.json" <<'JSON'
{
  "category": "banking",
  "sequence": ["계좌", "이체"]
}
JSON

cat > "$WORK_DIR/gloss-recommend-validation-error.json" <<'JSON'
{
  "category": "   ",
  "sequence": ["계좌", "이체"]
}
JSON

echo "Backend base URL: $BACKEND_BASE_URL"
echo "Audio sample     : $AUDIO_FILE"

if [[ ! -f "$AUDIO_FILE" ]]; then
  echo "Audio file not found: $AUDIO_FILE" >&2
  exit 1
fi

run_json_scenario \
  "sign-to-speech success" \
  "POST" \
  "/api/translation/sign-to-speech" \
  "$WORK_DIR/sign-to-speech-success.json" \
  "은행 창구에서 고객이 계좌 이체나 통장 재발급 같은 업무를 수어로 표현했다고 가정하고, MediaPipe frame 1개가 포함된 sign-to-speech 요청을 Spring으로 보냅니다. Spring은 이 payload를 FastAPI /sign-to-speech로 전달해 수어 keypoint를 음성 변환 요청으로 중계합니다." \
  "성공 시 HTTP 200과 함께 code=SUCCESS, data.type=sign_to_speech_result, glosses, korean, audio_url이 포함된 응답을 기대합니다. 실제 korean/glosses 내용은 모델 상태에 따라 달라질 수 있지만 은행 업무 맥락의 번역 결과가 반환되는지 확인합니다."

run_json_scenario \
  "sign-to-speech spring validation error" \
  "POST" \
  "/api/translation/sign-to-speech" \
  "$WORK_DIR/sign-to-speech-validation-error.json" \
  "은행 도메인 요청이라도 frames를 빈 배열로 보내면 Spring Controller의 @Valid 검증이 먼저 실패하는지 확인합니다. 이 요청은 FastAPI까지 가지 않고 Spring 입력 검증 단계에서 차단되는 시나리오입니다." \
  "실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 frames must not be empty 같은 Spring 검증 메시지가 내려오길 기대합니다."

run_multipart_scenario \
  "speech-to-sign audio success" \
  "/api/translation/speech-to-sign" \
  "$AUDIO_FILE" \
  "은행 상담 음성이 들어왔다고 가정하고, 샘플 오디오 파일을 multipart/form-data로 업로드해 speech-to-sign 오디오 변환 요청을 보냅니다. Spring은 파일을 받아 FastAPI /speech-to-sign로 전달합니다." \
  "성공 시 HTTP 200과 함께 code=SUCCESS, data.type=speech_to_sign_result, korean, glosses, gloss_str, keypoint_payload가 포함된 응답을 기대합니다. 실제 인식 문장은 샘플 음성에 따라 달라지지만 계좌, 이체, 통장, 재발급 같은 업무 표현으로 연결되는지 확인합니다."

run_multipart_without_file_scenario \
  "speech-to-sign missing file validation error" \
  "/api/translation/speech-to-sign" \
  "multipart 요청은 보내지만 file 파트를 비워서 Spring이 업로드 파일 누락을 어떻게 처리하는지 확인합니다. 이 요청은 FastAPI까지 가지 않고 Spring 요청 바인딩 단계에서 실패하는 시나리오입니다." \
  "실패 시 HTTP 400 또는 500 계열 응답과 함께 file 파트가 없다는 내용이 드러나는지 확인합니다. 현재 전역 예외 처리 범위 밖이면 Spring 기본 에러 응답이 보일 수 있습니다."

run_json_scenario \
  "text-to-sign success" \
  "POST" \
  "/api/translation/text-to-sign" \
  "$WORK_DIR/text-to-sign-success.json" \
  "은행 창구에서 자주 나올 수 있는 문장인 '통장 재발급을 도와주세요.'를 text-to-sign 요청으로 보내 FastAPI의 텍스트 기반 수어 변환 경로를 검증합니다. Spring은 JSON 본문을 FastAPI /text-to-sign로 전달합니다." \
  "성공 시 HTTP 200과 함께 code=SUCCESS, data 안에 korean, glosses, gloss_str, keypoint_url, keypoint_payload가 포함되길 기대합니다. glosses 역시 통장/재발급/부탁 계열의 은행 업무 표현으로 나오는지 확인합니다."

run_json_scenario \
  "text-to-sign spring validation error" \
  "POST" \
  "/api/translation/text-to-sign" \
  "$WORK_DIR/text-to-sign-validation-error.json" \
  "text 값에 공백만 넣어 Spring Controller의 @NotBlank 검증이 먼저 실패하는지 확인합니다. 이 요청은 FastAPI에 전달되지 않는 입력 검증 예외 시나리오입니다." \
  "실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 text가 비어 있으면 안 된다는 검증 메시지가 내려오길 기대합니다."

run_json_scenario \
  "glosses-to-speech success" \
  "POST" \
  "/api/translation/glosses-to-speech" \
  "$WORK_DIR/glosses-to-speech-success.json" \
  "은행 업무 맥락의 gloss 문자열 목록인 '통장, 재발급, 부탁'을 speech 합성 요청으로 보내 glosses-to-speech 성공 경로를 검증합니다. Spring은 이 목록을 FastAPI /glosses-to-speech로 전달합니다." \
  "성공 시 HTTP 200과 함께 code=SUCCESS, data.type=sign_to_speech_result, glosses, korean, audio_url이 포함된 응답을 기대합니다. korean 문장도 통장 재발급 요청에 가까운 은행 문맥으로 생성되는지 확인합니다."

run_json_scenario \
  "glosses-to-speech spring validation error" \
  "POST" \
  "/api/translation/glosses-to-speech" \
  "$WORK_DIR/glosses-to-speech-validation-error.json" \
  "glosses를 빈 배열로 보내 Spring Controller의 @NotEmpty 검증이 먼저 실패하는지 확인합니다. FastAPI 이전 단계에서 차단되는 대표 입력 검증 예외 시나리오입니다." \
  "실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 glosses must not be empty 같은 Spring 검증 메시지가 내려오길 기대합니다."

run_json_scenario \
  "glosses-to-speech fastapi detailed error" \
  "POST" \
  "/api/translation/glosses-to-speech" \
  "$WORK_DIR/glosses-to-speech-fastapi-error.json" \
  "은행 도메인 요청이라도 gloss 값이 공백뿐이면 공통 예외가 나는지 확인하기 위해 공백만 들어 있는 gloss 배열을 보냅니다. Spring이 FastAPI 상세 에러를 읽어 React용 응답 code/message에 반영하는지 확인하는 핵심 시나리오입니다." \
  "실패 시 HTTP 502를 유지하되, 응답 본문에는 code=GLOSS_LIST_EMPTY, message=gloss 목록이 비어 있습니다. 같은 FastAPI 상세 에러가 들어오길 기대합니다."

run_json_scenario \
  "gloss recommend success" \
  "POST" \
  "/api/glosses/recommend" \
  "$WORK_DIR/gloss-recommend-success.json" \
  "은행 도메인 맥락에서 gloss 추천 요청을 보내 Spring GlossController와 FastAPI /glosses/recommend 연동을 확인합니다. category=banking, sequence=계좌/이체를 기반으로 추천 목록을 조회하는 시나리오입니다." \
  "성공 시 HTTP 200과 함께 code=SUCCESS, data.recommendations 배열이 포함된 응답을 기대합니다. 추천 결과도 송금, 입금, 출금, 통장, 재발급처럼 은행 업무와 연결된 단어들인지 확인합니다."

run_json_scenario \
  "gloss recommend spring validation error" \
  "POST" \
  "/api/glosses/recommend" \
  "$WORK_DIR/gloss-recommend-validation-error.json" \
  "category에 공백만 넣어 Spring Controller의 @NotBlank 검증이 먼저 실패하는지 확인합니다. 추천 요청의 입력 검증 예외 시나리오입니다." \
  "실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 category가 비어 있으면 안 된다는 검증 메시지가 내려오길 기대합니다."
