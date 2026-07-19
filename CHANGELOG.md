# Changelog

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
