#!/usr/bin/env python3
"""Local Whisper sidecar for the Voice Agent VS Code/Cursor extension.

Uses faster-whisper when available; falls back to openai-whisper.
Install into the extension .venv via scripts/setup_whisper.sh (PEP 668 safe).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def import_transcriber():
    try:
        from faster_whisper import WhisperModel  # type: ignore

        return ("faster", WhisperModel)
    except Exception:
        pass

    try:
        import whisper  # type: ignore

        return ("openai", whisper)
    except Exception as exc:
        raise RuntimeError(
            "Neither faster-whisper nor openai-whisper is installed.\n"
            "Run: ./scripts/setup_whisper.sh\n"
            f"Detail: {exc}"
        ) from exc


def in_venv() -> bool:
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix)


def setup(model_name: str) -> str:
    try:
        import faster_whisper  # noqa: F401
    except Exception:
        if not in_venv():
            raise RuntimeError(
                "faster-whisper is missing and this is not a virtualenv.\n"
                "Debian/Ubuntu block system-wide pip (PEP 668).\n"
                "Run: ./scripts/setup_whisper.sh"
            )
        eprint("Installing faster-whisper into the active venv…")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "faster-whisper"],
            stdout=sys.stderr,
        )

    kind, WhisperModel = import_transcriber()
    if kind == "faster":
        WhisperModel(model_name, device="cpu", compute_type="int8")
        return f"faster-whisper ready (model={model_name}, python={sys.executable})"

    WhisperModel.load_model(model_name)
    return f"openai-whisper ready (model={model_name}, python={sys.executable})"


def check() -> None:
    import_transcriber()
    print(json.dumps({"ok": True, "python": sys.executable, "venv": in_venv()}))


def transcribe(audio: str, model_name: str, language: str) -> dict:
    kind, mod = import_transcriber()
    lang = None if language in ("", "auto") else language

    if kind == "faster":
        model = mod(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(audio, language=lang, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {
            "text": text,
            "language": getattr(info, "language", language or "unknown"),
            "engine": "faster-whisper",
        }

    model = mod.load_model(model_name)
    result = model.transcribe(audio, language=lang)
    return {
        "text": (result.get("text") or "").strip(),
        "language": result.get("language") or language or "unknown",
        "engine": "openai-whisper",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Voice Agent Whisper sidecar")
    parser.add_argument("--audio", help="Path to WAV/audio file")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "base"))
    parser.add_argument("--language", default=os.environ.get("WHISPER_LANGUAGE", "pt"))
    parser.add_argument("--json", action="store_true", help="Print JSON result")
    parser.add_argument("--setup", action="store_true", help="Install deps + download model")
    parser.add_argument("--check", action="store_true", help="Verify installation")
    args = parser.parse_args()

    try:
        if args.setup:
            msg = setup(args.model)
            print(msg)
            return 0
        if args.check:
            check()
            return 0
        if not args.audio:
            parser.error("--audio is required unless --setup or --check")
        result = transcribe(args.audio, args.model, args.language)
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(result["text"])
        return 0
    except Exception as exc:
        eprint(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
