#!/usr/bin/env bash
set -euo pipefail

export LKS_PROFILE=local
export LKS_PRELOAD_MODELS=true
export LKS_ENABLE_TTS=true
export LKS_ENABLE_STT=true

cd "$(dirname "$0")"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
