$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {
    throw "conda 명령을 찾지 못했습니다. Anaconda/Miniconda가 설치되어 있고 PATH에 잡혀 있는지 확인해 주세요."
}

$env:LKS_PROFILE = "jetson"
$env:LKS_PRELOAD_MODELS = "true"
$env:LKS_ENABLE_TTS = "true"
$env:LKS_ENABLE_STT = "true"
$env:LKS_DEMO_SCRIPT = "bank"

conda run --live-stream -n sonpyeonji-ai python -m uvicorn app.main:app --host 0.0.0.0 --port 8000