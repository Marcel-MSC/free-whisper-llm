# Local setup and updates in Cursor

This guide explains how to run, install, and update Voice Agent locally in Cursor.

## Requirements

- Cursor
- Node.js 20 or newer
- npm
- Python 3.10 or newer
- Ollama, or an OpenAI/Anthropic API key

For microphone capture under WSL/Linux:

```bash
sudo apt install pulseaudio-utils alsa-utils
```

## Run from source

1. Open this repository as a folder in Cursor.
2. Install the Node.js dependencies:

   ```bash
   npm install
   ```

3. Compile and test the extension:

   ```bash
   npm run compile
   npm test
   npm run lint
   ```

4. Press `F5` in Cursor and select **Run Extension** if prompted.
5. A new Extension Development Host window opens with the local extension.
6. In that window, run **Voice Agent: Setup Whisper** from the Command Palette.

Changes to TypeScript require recompilation. During development, keep this running:

```bash
npm run watch
```

After a change, reload the Extension Development Host with **Developer: Reload Window**.

## Build and install a local VSIX

Build the installable package:

```bash
npm run package
```

This creates a file such as `free-whisper-llm-0.2.0.vsix` in the repository root.

Install it through Cursor:

1. Open the Extensions view.
2. Select the `…` menu.
3. Choose **Install from VSIX…**.
4. Select the generated `.vsix` file.
5. Reload Cursor when prompted.

Alternatively, if the `cursor` command is available:

```bash
cursor --install-extension ./free-whisper-llm-0.2.0.vsix --force
```

## Update an existing local installation

1. Pull or copy the latest source changes.
2. Refresh dependencies and verify the project:

   ```bash
   npm install
   npm test
   npm run lint
   ```

3. Update the `version` in `package.json` when producing a new distributable release.
4. Build the new package:

   ```bash
   npm run package
   ```

5. Install the new `.vsix` using **Install from VSIX…** or the CLI command with `--force`.
6. Run **Developer: Reload Window**.

Installing an update preserves VS Code/Cursor extension global state and Secret Storage, including settings, API keys, licenses, and local session history. Use **Voice Agent: Clear History** if you want to remove saved history.

## Configure the extension

Open Cursor Settings and search for `Voice Agent`.

Recommended local configuration:

- `voiceAgent.llm.provider`: `ollama`
- `voiceAgent.llm.baseUrl`: `http://127.0.0.1:11434`
- `voiceAgent.llm.model`: an installed Ollama model, such as `llama3.2`
- `voiceAgent.audio.captureMode`: `auto`

For OpenAI or Anthropic, run **Voice Agent: Set API Key** instead of putting a key in `settings.json`.

Useful commands:

- **Voice Agent: Open Panel**
- **Voice Agent: Setup Whisper**
- **Voice Agent: Health Check**
- **Voice Agent: Show Privacy Notice**
- **Voice Agent: Clear History**

## Troubleshooting

### Whisper is not ready

Run **Voice Agent: Setup Whisper**. The shared Python environment is installed under:

```text
~/.local/share/voice-agent/.venv
```

### Microphone fails in WSL

Keep `voiceAgent.audio.captureMode` set to `auto` or `native`, install the PulseAudio tools shown above, and verify that Windows allows Cursor to access the microphone.

### The new code is not visible

- Source development: run `npm run compile` and reload the Extension Development Host.
- VSIX installation: rebuild the package, reinstall it with `--force`, and reload Cursor.
- Confirm that the installed extension version matches `package.json`.

### Validate the package before sharing

```bash
npm run smoke:package
```
