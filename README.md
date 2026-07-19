# Voice Agent (free-whisper-llm)

Extensão para **VS Code** e **Cursor**: fale no microfone (ou digite), o **Whisper local** transcreve, e um **agent próprio** classifica a intenção e executa:

| Intent | O que faz |
|--------|-----------|
| **plan** | Gera um plano em markdown (não edita arquivos) |
| **ask** | Responde perguntas com contexto do editor |
| **edit** | Propõe patches/edições com **diff** e confirmação |
| **shell** | Monta um comando, classifica risco e roda no terminal (com confirmação) |

## Privacidade (importante)

- **Áudio** fica na máquina (Whisper local). Arquivos WAV temporários são apagados após a transcrição.
- O **texto da transcrição** e o **contexto do editor/workspace** (arquivo ativo, seleção, paths; no Pro também trechos de busca) são enviados ao **LLM que você configurar**.
- Com **Ollama em localhost**, isso costuma permanecer local.
- Com **OpenAI / Anthropic** (ou Ollama remoto), o contexto **sai da máquina**.

API keys e licenças Pro ficam no **Secret Storage** do VS Code (não em settings sync).  
Veja [PRIVACY.md](PRIVACY.md).

## Free vs Pro

| | Free | Pro |
|--|------|-----|
| Whisper local + BYOK/Ollama | ✓ | ✓ |
| plan / ask / edit / shell | ✓ (edit 1 arquivo) | ✓ multi-arquivo |
| Diff + confirmação + shell risk gates | ✓ | ✓ |
| Busca no workspace / contexto rico | | ✓ |
| Histórico de sessão | | ✓ |
| Warm Whisper sidecar | | ✓ |

Comandos: **Activate Pro License**, **Manage Subscription / Checkout**, **Show Plan**.  
Pilot keys: `node scripts/mint_license.js you@example.com`.

## Pré-requisitos

1. **Node.js 20+** (para desenvolver / empacotar)
2. **Python 3.10+** com `pip` / `venv`
3. **Ollama** (recomendado) com um modelo, ex.: `ollama pull llama3.2`  
   — ou API key OpenAI / Anthropic via **Voice Agent: Set API Key**

## Setup Whisper (local)

```bash
chmod +x scripts/setup_whisper.sh
./scripts/setup_whisper.sh
```

Ou: Command Palette → **Voice Agent: Setup Whisper**.

Isso cria um venv em `~/.local/share/voice-agent/.venv` (sobrevive a reinstalação do `.vsix`), instala `faster-whisper` e baixa o modelo (`base` por padrão).

**Importante:** depois de instalar o VSIX, rode **Voice Agent: Setup Whisper** uma vez.

## Microfone no WSL / Cursor Remote

No **Cursor + WSL**, o webview do painel roda no Windows e o `getUserMedia` costuma falhar com `Permission denied`.

A extensão usa captura **nativa no Linux** (PulseAudio via WSLg) por padrão em `linux`:

```bash
sudo apt install pulseaudio-utils alsa-utils
```

Settings: `voiceAgent.audio.captureMode` — `auto` / `native` / `webview`.

## Desenvolvimento

```bash
npm install
npm run compile
npm test
npm run lint
```

No VS Code/Cursor: abra esta pasta → **F5** (Run Extension).

```bash
npm run package          # gera .vsix
npm run smoke:package    # valida conteúdo do .vsix
```

## Uso

1. Configure o LLM em **Settings → Voice Agent** (`voiceAgent.llm.*`)
2. Para cloud providers: **Voice Agent: Set API Key**
3. Opcional: **Voice Agent: Health Check**
4. `Ctrl+Shift+Space` / `Cmd+Shift+Space`, clique no **mic**, ou **Type instead**
5. Revise o transcript → **Send to agent** (`Ctrl+Enter`)
6. Confirme diffs de edit e comandos de shell quando pedido

## Settings principais

| Setting | Default | Descrição |
|---------|---------|-----------|
| `voiceAgent.whisper.model` | `base` | tiny / base / small / medium / large-v3 |
| `voiceAgent.whisper.language` | `pt` | Idioma do STT (`auto` para detectar) |
| `voiceAgent.whisper.warmSidecar` | `true` | Sidecar quente (Pro) |
| `voiceAgent.audio.captureMode` | `auto` | auto / webview / native |
| `voiceAgent.llm.provider` | `ollama` | ollama / openai / anthropic |
| `voiceAgent.llm.baseUrl` | `http://127.0.0.1:11434` | Ollama ou OpenAI-compatible |
| `voiceAgent.llm.model` | `llama3.2` | Nome do modelo |
| `voiceAgent.llm.timeoutMs` | `90000` | Timeout HTTP |
| `voiceAgent.llm.retries` | `2` | Retries |
| `voiceAgent.shell.confirm` | `true` | Confirmar shell low-risk |
| `voiceAgent.analytics.enabled` | `true` | Analytics local privacy-safe |
| `voiceAgent.billing.checkoutUrl` | _(placeholder)_ | URL de checkout Pro |

> `voiceAgent.llm.apiKey` está **deprecated** — use Secret Storage.

## Arquitetura

```
Mic / typed prompt → (WAV) → Whisper (local, optional warm sidecar)
                           → intent router (LLM JSON)
                           → plan | ask | edit (diff) | shell (risk)
```

## Soft launch

See [docs/SOFT_LAUNCH.md](docs/SOFT_LAUNCH.md), [CHANGELOG.md](CHANGELOG.md), [SUPPORT.md](SUPPORT.md).

## Licença

[MIT](LICENSE)
