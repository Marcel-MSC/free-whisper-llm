# Voice Agent (free-whisper-llm)

Extensão para **VS Code** e **Cursor**: fale no microfone, o **Whisper local** transcreve, e um **agent próprio** classifica a intenção e executa:

| Intent | O que faz |
|--------|-----------|
| **plan** | Gera um plano em markdown (não edita arquivos) |
| **ask** | Responde perguntas com contexto do editor |
| **edit** | Propõe e aplica edições de código (com confirmação) |
| **shell** | Monta e roda um comando no terminal (bash / PowerShell / cmd, com confirmação) |

Áudio **não** sai da máquina. Só o texto da transcrição vai para o LLM que você configurar (Ollama por padrão).

## Pré-requisitos

1. **Node.js 20+** (para desenvolver / empacotar)
2. **Python 3.10+** com `pip`
3. **Ollama** (recomendado) com um modelo, ex.: `ollama pull llama3.2`  
   — ou API key OpenAI / Anthropic nas settings

## Setup Whisper (local)

No Debian/Ubuntu o `pip install --user` é bloqueado (PEP 668). O setup cria um **venv** em `.venv/`:

```bash
# se necessário: sudo apt install python3 python3-venv python3-full
chmod +x scripts/setup_whisper.sh
./scripts/setup_whisper.sh
```

Ou, com a extensão já instalada: Command Palette → **Voice Agent: Setup Whisper**.

Isso cria `.venv`, instala `faster-whisper` lá e baixa o modelo (`base` por padrão). A extensão usa `.venv/bin/python` automaticamente quando `voiceAgent.whisper.pythonPath` está em `python3`.

## Desenvolvimento

```bash
npm install
npm run compile
```

No VS Code/Cursor: abra esta pasta → **F5** (Run Extension) ou:

```bash
# empacota .vsix
npm run package
# depois: Extensions → Install from VSIX…
```

## Uso

1. Configure o LLM em **Settings → Voice Agent** (`voiceAgent.llm.*`)
2. `Ctrl+Shift+Space` / `Cmd+Shift+Space` ou clique no ícone **mic** na status bar
3. Fale → solte / clique de novo para parar
4. Confirme edits multi-arquivo e comandos de shell quando pedido

Comandos:

- `Voice Agent: Talk`
- `Voice Agent: Stop Recording`
- `Voice Agent: Open Panel`
- `Voice Agent: Setup Whisper`

## Settings principais

| Setting | Default | Descrição |
|---------|---------|-----------|
| `voiceAgent.whisper.model` | `base` | tiny / base / small / medium / large-v3 |
| `voiceAgent.whisper.language` | `pt` | Idioma do STT (`auto` para detectar) |
| `voiceAgent.whisper.pythonPath` | `python3` | Auto-usa `.venv` se existir; senão `python3` |
| `voiceAgent.llm.provider` | `ollama` | ollama / openai / anthropic |
| `voiceAgent.llm.baseUrl` | `http://127.0.0.1:11434` | Ollama ou OpenAI-compatible |
| `voiceAgent.llm.model` | `llama3.2` | Nome do modelo |
| `voiceAgent.llm.apiKey` | _(vazio)_ | OpenAI / Anthropic |
| `voiceAgent.shell.confirm` | `true` | Confirmar antes de rodar shell |
| `voiceAgent.edit.confirmMultiFile` | `true` | Confirmar edits multi-arquivo |

## Arquitetura (MVP)

```
Mic (webview) → WAV → scripts/whisper_transcribe.py
                     → intent router (LLM JSON)
                     → plan | ask | edit | shell
```

## Limitações do MVP

- Sem streaming da resposta LLM
- Sem hotword
- Edits enviam o **arquivo completo** (não hunks parciais)
- Shell sempre via terminal integrado (não captura stdout de volta ao painel)

## Licença

Uso pessoal / proprietário conforme você definir ao publicar.
