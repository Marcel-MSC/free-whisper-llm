# Privacy Policy — Voice Agent

Last updated: 2026-07-18

## Summary

- **Microphone audio** is processed **locally** with Whisper on your machine. Audio files are written to a temporary directory and deleted after transcription.
- **Transcript text** and **editor/workspace context** (active file excerpt, selection, paths, and — on Pro — search snippets) are sent to the **LLM provider you configure**.
- With **Ollama on localhost**, that context typically stays on your machine.
- With **OpenAI / Anthropic** (or a remote Ollama URL), that context leaves your machine and is subject to the provider’s privacy policy.

## What we do not collect

This extension does **not** operate a first-party cloud that receives your source code or audio by default.

Optional **local analytics** (off via `voiceAgent.analytics.enabled`) write event counts such as setup success, transcription latency buckets, intent labels, edit accept/reject, and license actions to:

`~/.local/share/voice-agent/analytics.jsonl`

These events **never** include audio, full transcripts, or file contents.

## Credentials

API keys and Pro license keys are stored in **VS Code Secret Storage**, not in plain settings sync. A deprecated `voiceAgent.llm.apiKey` setting may be migrated once into Secret Storage and cleared.

## Session history (Pro)

With Pro **session history**, the extension may keep a **local** bounded list of:

- Voice transcripts and typed prompts (including discarded drafts, when enabled)
- Run outcomes (success, error, cancel) with short result previews

This data lives in VS Code extension global state on your machine (not uploaded by Voice Agent). It is **not** raw audio. Controls:

- Panel: **Show history** / **Load more** / click an item to reuse
- Command: **Voice Agent: Clear History**
- Settings: `voiceAgent.history.maxEntries`, `voiceAgent.history.recordDrafts`

## Your controls

- Command: **Voice Agent: Show Privacy Notice**
- Command: **Voice Agent: Reset Privacy Consent**
- Command: **Voice Agent: Clear History**
- Settings: LLM provider / base URL
- Setting: `voiceAgent.analytics.enabled`
- Settings: `voiceAgent.history.maxEntries`, `voiceAgent.history.recordDrafts`

## Contact

Open an issue in the project repository for privacy questions or data-handling concerns.
