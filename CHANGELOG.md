# Changelog

## Unreleased

### UX improvements

- Agent **progress steps** in the panel (gathering context → routing → intent handler → done).
- **Workspace** picker among open Cursor/VS Code folders; relative reads/writes use the selected root.
- **Copy** buttons for transcript, intent, and result.
- In-panel **Whisper language** button (`pt|en|es|fr|de|it|auto`); does not change the LLM. Docs note Llama 3.2 official languages.
- Edits always confirm unless **Always approve edits** is on (persisted); shell confirms unchanged.
- Mic **auto-stop** after `voiceAgent.audio.autoStopMs` (default 5000).
- Renamed **Transcript history**; list titles use intent/summary resume; Show transcripts / Load more.

### Session history

- Pro history now records voice/typed drafts, discards, and run success/error/cancel (not only successful runs).
- Panel: **Show transcripts** lists the latest 10 inputs; **Load more** appends 10 at a time; click an item to reuse.
- Settings: `voiceAgent.history.maxEntries` (default 100), `voiceAgent.history.recordDrafts`.
- Privacy disclosure updated for local transcript history retention and **Clear Transcript History**.

## 0.2.0 — 2026-07-18

### Trust & safety

- Accurate privacy disclosure: transcript **and** editor/workspace context may be sent to the configured LLM.
- First-run privacy consent; **Show Privacy Notice** / **Reset Privacy Consent** commands.
- API keys migrated to VS Code **Secret Storage** (`Set API Key` / `Clear API Key`).
- Edit flow shows **unified diffs**, prefers bounded patches, detects dirty buffers, canonicalizes paths.
- Shell risk classification with blocklists; medium/high risk always confirm; terminal marker for generated commands.

### Agent & UX

- Pro: workspace search + related file context for multi-file awareness.
- Pro: multi-file patches, session history, warm Whisper sidecar.
- Typed prompts without recording; Markdown result rendering; copy/retry; cancel button.
- LLM timeouts, retries/backoff; provider health check.
- Onboarding walkthrough in the Marketplace / Extensions view.

### Monetization

- Free core (local STT + BYOK/Ollama basic intents) vs **Pro** license (`VA-PRO-…` keys).
- Activate / deactivate license; checkout & customer portal URLs (configurable).
- Offline entitlement cache (7-day grace).

### Release engineering

- Unit tests for risk/diff/path/search/license.
- GitHub Actions CI (`lint`, `test`, packaging smoke).
- MIT license, PRIVACY, SECURITY, SUPPORT, CHANGELOG.
- Version bump to 0.2.0.

### Analytics

- Privacy-safe local JSONL metrics (no audio/source/transcripts).

## 0.1.3

- Initial MVP: local Whisper, intent router, plan/ask/edit/shell, WSL native capture.
