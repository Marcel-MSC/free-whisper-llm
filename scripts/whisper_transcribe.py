#!/usr/bin/env python3
"""Local Whisper sidecar for the Voice Agent VS Code/Cursor extension.

Supports one-shot transcription and a persistent --serve mode that keeps
the model warm between requests (JSON-lines over stdin/stdout).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import traceback


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


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


_MODEL_CACHE: dict[str, object] = {}
_ENGINE: str | None = None


def get_model(model_name: str):
    global _ENGINE
    kind, mod = import_transcriber()
    _ENGINE = "faster-whisper" if kind == "faster" else "openai-whisper"
    key = f"{kind}:{model_name}"
    if key in _MODEL_CACHE:
        return kind, _MODEL_CACHE[key]
    if kind == "faster":
        model = mod(model_name, device="cpu", compute_type="int8")
    else:
        model = mod.load_model(model_name)
    _MODEL_CACHE[key] = model
    return kind, model


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

    get_model(model_name)
    return f"faster-whisper ready (model={model_name}, python={sys.executable})"


def check() -> None:
    import_transcriber()
    print(json.dumps({"ok": True, "python": sys.executable, "venv": in_venv()}))


def transcribe(audio: str, model_name: str, language: str) -> dict:
    kind, model = get_model(model_name)
    lang = None if language in ("", "auto") else language

    if kind == "faster":
        segments, info = model.transcribe(audio, language=lang, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {
            "text": text,
            "language": getattr(info, "language", language or "unknown"),
            "engine": "faster-whisper",
        }

    result = model.transcribe(audio, language=lang)
    return {
        "text": (result.get("text") or "").strip(),
        "language": result.get("language") or language or "unknown",
        "engine": "openai-whisper",
    }


def serve(default_model: str, default_language: str) -> int:
    """JSON-lines protocol:
    {"cmd":"transcribe","audio":"...","model":"...","language":"..."}
    {"cmd":"ping"}
    {"cmd":"shutdown"}
    Responses are single JSON objects on stdout.
    """
    eprint(f"whisper serve ready (python={sys.executable})")
    # Preload default model
    try:
        get_model(default_model)
        eprint(f"warmed model={default_model}")
    except Exception as exc:
        eprint(f"warm preload failed: {exc}")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as exc:
            print(json.dumps({"ok": False, "error": f"bad json: {exc}"}), flush=True)
            continue

        cmd = req.get("cmd")
        try:
            if cmd == "ping":
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "engine": _ENGINE,
                            "cached": list(_MODEL_CACHE.keys()),
                        }
                    ),
                    flush=True,
                )
            elif cmd == "shutdown":
                print(json.dumps({"ok": True, "bye": True}), flush=True)
                return 0
            elif cmd == "transcribe":
                audio = req.get("audio")
                if not audio:
                    raise RuntimeError("audio required")
                model = req.get("model") or default_model
                language = req.get("language") or default_language
                result = transcribe(audio, model, language)
                print(json.dumps({"ok": True, **result}, ensure_ascii=False), flush=True)
            else:
                print(json.dumps({"ok": False, "error": f"unknown cmd: {cmd}"}), flush=True)
        except Exception as exc:
            eprint(traceback.format_exc())
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Voice Agent Whisper sidecar")
    parser.add_argument("--audio", help="Path to WAV/audio file")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "base"))
    parser.add_argument("--language", default=os.environ.get("WHISPER_LANGUAGE", "pt"))
    parser.add_argument("--json", action="store_true", help="Print JSON result")
    parser.add_argument("--setup", action="store_true", help="Install deps + download model")
    parser.add_argument("--check", action="store_true", help="Verify installation")
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Keep model warm; accept JSON-lines requests on stdin",
    )
    args = parser.parse_args()

    try:
        if args.setup:
            msg = setup(args.model)
            print(msg)
            return 0
        if args.check:
            check()
            return 0
        if args.serve:
            return serve(args.model, args.language)
        if not args.audio:
            parser.error("--audio is required unless --setup, --check, or --serve")
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
