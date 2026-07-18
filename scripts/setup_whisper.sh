#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYSTEM_PYTHON="${VOICE_AGENT_PYTHON:-python3}"
VENV="$ROOT/.venv"
MODEL="${WHISPER_MODEL:-base}"

if ! command -v "$SYSTEM_PYTHON" >/dev/null 2>&1; then
  echo "Python not found: $SYSTEM_PYTHON" >&2
  echo "Install python3 and python3-venv (e.g. sudo apt install python3 python3-venv python3-full)" >&2
  exit 1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating virtualenv at $VENV"
  "$SYSTEM_PYTHON" -m venv "$VENV"
fi

PYTHON="$VENV/bin/python"
PIP="$VENV/bin/pip"

echo "Using venv Python: $PYTHON"
"$PIP" install -U pip
"$PIP" install -r "$ROOT/scripts/requirements.txt"
"$PYTHON" "$ROOT/scripts/whisper_transcribe.py" --setup --model "$MODEL"

echo ""
echo "Done. Point Voice Agent to this interpreter if needed:"
echo "  voiceAgent.whisper.pythonPath = $PYTHON"
echo "In VS Code/Cursor run: Voice Agent: Talk"
