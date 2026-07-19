# Soft launch checklist

## Before publishing

1. `npm ci && npm test && npm run smoke:package`
2. Replace placeholder URLs:
   - `voiceAgent.billing.checkoutUrl`
   - `voiceAgent.billing.portalUrl`
   - `repository` / `homepage` / `bugs` in `package.json` if needed
3. Set a strong `VOICE_AGENT_LICENSE_SECRET` when minting production keys.
4. Mint pilot keys: `node scripts/mint_license.js pilot@example.com 2026-12-31T00:00:00.000Z`
5. Add Marketplace icon/screenshots under `media/` when available.
6. Confirm [PRIVACY.md](../PRIVACY.md), [LICENSE](../LICENSE), [SUPPORT.md](../SUPPORT.md).

## Pilot metrics to watch

Use **Voice Agent: Show Local Analytics** (or `~/.local/share/voice-agent/analytics.jsonl`):

| Event | Meaning |
|-------|---------|
| `setup_success` / `setup_failure` | Onboarding friction |
| `transcribe_ok` (+ `ms`) | STT latency |
| `agent_intent` | Intent mix |
| `edit_accept` / `edit_reject` | Edit quality |
| `shell_run` / `shell_block` | Shell safety |
| `first_success` | Activation |
| `license_activate` / `purchase_click` | Conversion funnel |

## Success criteria (suggested)

- Setup → first success > 50% of pilot users
- Edit accept rate > 60% of proposed edits
- Refund / deactivate rate < 10% in first 14 days
- No P0 path-escape or shell-bypass incidents
