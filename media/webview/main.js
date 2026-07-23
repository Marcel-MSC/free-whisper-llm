(function () {
  const vscode = acquireVsCodeApi();

  const micBtn = document.getElementById("micBtn");
  const micLabel = document.getElementById("micLabel");
  const typeBtn = document.getElementById("typeBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const transcriptEdit = document.getElementById("transcriptEdit");
  const reviewActions = document.getElementById("reviewActions");
  const sendBtn = document.getElementById("sendBtn");
  const discardBtn = document.getElementById("discardBtn");
  const copyBtn = document.getElementById("copyBtn");
  const copyTranscriptBtn = document.getElementById("copyTranscriptBtn");
  const copyIntentBtn = document.getElementById("copyIntentBtn");
  const retryBtn = document.getElementById("retryBtn");
  const intentMetaEl = document.getElementById("intentMeta");
  const summaryEl = document.getElementById("summary");
  const resultEl = document.getElementById("result");
  const historyEl = document.getElementById("history");
  const planBadge = document.getElementById("planBadge");
  const errorCard = document.getElementById("errorCard");
  const errorEl = document.getElementById("error");
  const showHistoryBtn = document.getElementById("showHistoryBtn");
  const hideHistoryBtn = document.getElementById("hideHistoryBtn");
  const loadMoreHistoryBtn = document.getElementById("loadMoreHistoryBtn");
  const historyActions = document.getElementById("historyActions");
  const historyCount = document.getElementById("historyCount");
  const historyControls = document.getElementById("historyControls");
  const langBtn = document.getElementById("langBtn");
  const alwaysApproveBtn = document.getElementById("alwaysApproveBtn");
  const workspaceSelect = document.getElementById("workspaceSelect");
  const progressCard = document.getElementById("progressCard");
  const progressList = document.getElementById("progressList");

  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let source = null;
  let recording = false;
  let nativeMode = false;
  let reviewMode = false;
  let lastTranscript = "";
  let lastResultText = "";
  let lastSummary = "";
  let lastIntentMeta = "";
  let historyOpen = false;
  let historyOffset = 0;
  let historyHasMore = false;
  let historyPro = false;
  let historyTotal = 0;
  let autoStopMs = 5000;
  let autoStopTimer = null;
  let autoStopCountdown = null;
  const buffers = [];
  let sampleRate = 48000;

  function kindLabel(kind) {
    switch (kind) {
      case "draft_transcribed":
        return "voice draft";
      case "draft_typed":
        return "typed draft";
      case "draft_discarded":
        return "discarded";
      case "run_success":
        return "run";
      case "run_error":
        return "error";
      case "run_cancelled":
        return "cancelled";
      default:
        return kind || "entry";
    }
  }

  function clearAutoStop() {
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
    if (autoStopCountdown) {
      clearInterval(autoStopCountdown);
      autoStopCountdown = null;
    }
  }

  function armAutoStop(ms) {
    clearAutoStop();
    const duration = typeof ms === "number" && ms > 0 ? ms : autoStopMs;
    autoStopMs = duration;
    const endsAt = Date.now() + duration;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (recording) {
        micLabel.textContent = "Listening… auto-stops in " + left + "s";
      }
    };
    tick();
    autoStopCountdown = setInterval(tick, 250);
    autoStopTimer = setTimeout(() => {
      clearAutoStop();
      if (recording) {
        stopRecording();
      }
    }, duration);
  }

  function renderHistoryItems(items, append) {
    if (!append) {
      historyEl.innerHTML = "";
    }
    if (!items || !items.length) {
      if (!append) {
        historyEl.textContent = "No transcripts yet.";
        historyEl.classList.add("empty");
      }
      return;
    }
    historyEl.classList.remove("empty");
    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) {
      const h = items[i];
      const wrap = document.createElement("div");
      wrap.className = "hist-item";
      wrap.setAttribute("role", "button");
      wrap.tabIndex = 0;
      wrap.dataset.transcript = h.transcript || "";
      const meta = document.createElement("div");
      meta.className = "hist-meta";
      meta.textContent =
        (h.ts || "").slice(0, 19) + " · " + kindLabel(h.kind);
      const title = document.createElement("div");
      title.className = "hist-title";
      title.textContent = h.title || h.summary || h.transcript || "—";
      wrap.appendChild(meta);
      wrap.appendChild(title);
      if (h.transcript && h.transcript !== h.title) {
        const text = document.createElement("div");
        text.className = "hist-text";
        text.textContent = h.transcript;
        wrap.appendChild(text);
      }
      if (h.error) {
        const err = document.createElement("div");
        err.className = "hist-error";
        err.textContent = h.error;
        wrap.appendChild(err);
      }
      frag.appendChild(wrap);
    }
    historyEl.appendChild(frag);
  }

  function setHistoryUi(pro, total) {
    historyPro = !!pro;
    historyTotal = typeof total === "number" ? total : historyTotal;
    if (!historyPro) {
      historyControls.classList.add("hidden");
      historyActions.classList.add("hidden");
      historyEl.classList.add("empty");
      historyEl.textContent = "Upgrade to Pro for transcript history.";
      historyCount.textContent = "";
      return;
    }
    historyControls.classList.remove("hidden");
    historyCount.textContent = historyTotal
      ? historyTotal + " saved"
      : "empty";
    if (!historyOpen) {
      showHistoryBtn.classList.remove("hidden");
      hideHistoryBtn.classList.add("hidden");
      historyActions.classList.add("hidden");
      if (!historyEl.dataset.loaded) {
        historyEl.classList.add("empty");
        historyEl.textContent = "Click Show transcripts to list recent inputs.";
      }
    }
  }

  function openHistory(reset) {
    historyOpen = true;
    showHistoryBtn.classList.add("hidden");
    hideHistoryBtn.classList.remove("hidden");
    historyActions.classList.remove("hidden");
    historyEl.dataset.loaded = "1";
    const offset = reset ? 0 : historyOffset;
    vscode.postMessage({
      type: "loadHistory",
      offset: offset,
      limit: 10,
      reset: !!reset,
    });
  }

  function setText(el, text, empty) {
    el.textContent = text || "—";
    el.classList.toggle("empty", !!empty || !text);
  }

  function setHtml(el, html, empty) {
    if (!html) {
      el.textContent = "—";
      el.classList.add("empty");
      return;
    }
    el.innerHTML = html;
    el.classList.toggle("empty", !!empty);
  }

  function setRecordingUi(on, label) {
    recording = on;
    micBtn.classList.toggle("recording", on);
    micLabel.textContent = on
      ? label || "Listening… click to stop"
      : "Click to talk";
  }

  function setReviewUi(on, text) {
    reviewMode = on;
    if (on) {
      transcriptEl.classList.add("hidden");
      transcriptEdit.classList.remove("hidden");
      reviewActions.classList.remove("hidden");
      transcriptEdit.value = text || "";
      transcriptEdit.focus();
      transcriptEdit.setSelectionRange(
        transcriptEdit.value.length,
        transcriptEdit.value.length
      );
    } else {
      transcriptEdit.classList.add("hidden");
      reviewActions.classList.add("hidden");
      transcriptEl.classList.remove("hidden");
    }
  }

  function setBusyUi(busy) {
    cancelBtn.classList.toggle("hidden", !busy);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      statusEl.textContent = "copied";
    } catch (_) {
      statusEl.textContent = "copy-failed";
    }
  }

  function applySettings(msg) {
    if (msg.language) {
      langBtn.textContent = "Lang: " + msg.language;
    }
    if (typeof msg.autoStopMs === "number") {
      autoStopMs = msg.autoStopMs;
    }
    if (typeof msg.alwaysApproveEdits === "boolean") {
      alwaysApproveBtn.textContent =
        "Always approve edits: " + (msg.alwaysApproveEdits ? "on" : "off");
      alwaysApproveBtn.classList.toggle("active", !!msg.alwaysApproveEdits);
    }
    const folders = msg.workspaces || [];
    workspaceSelect.innerHTML = "";
    if (!folders.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Open a folder in Cursor";
      workspaceSelect.appendChild(opt);
      return;
    }
    for (let i = 0; i < folders.length; i++) {
      const f = folders[i];
      const opt = document.createElement("option");
      opt.value = f.path;
      opt.textContent = f.name || f.path;
      if (f.path === msg.selectedWorkspace) {
        opt.selected = true;
      }
      workspaceSelect.appendChild(opt);
    }
  }

  function renderProgress(steps, current) {
    if (!steps || !steps.length) {
      progressCard.classList.add("hidden");
      progressList.innerHTML = "";
      return;
    }
    progressCard.classList.remove("hidden");
    progressList.innerHTML = "";
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const li = document.createElement("li");
      li.textContent = s.label || s.step;
      if (s.step === current) {
        li.classList.add("current");
      }
      progressList.appendChild(li);
    }
  }

  async function startRecording() {
    if (recording) {
      return;
    }
    if (nativeMode) {
      setRecordingUi(true);
      armAutoStop(autoStopMs);
      return;
    }

    buffers.length = 0;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      audioContext = new AudioContext();
      sampleRate = audioContext.sampleRate;
      source = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!recording) {
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        buffers.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      setRecordingUi(true);
      armAutoStop(autoStopMs);
      vscode.postMessage({ type: "recordingStarted" });
    } catch (err) {
      clearAutoStop();
      setRecordingUi(false);
      vscode.postMessage({
        type: "micFailed",
        message: err && err.message ? err.message : String(err),
      });
    }
  }

  function stopRecording() {
    clearAutoStop();
    if (nativeMode) {
      setRecordingUi(false);
      vscode.postMessage({ type: "stopNative" });
      return;
    }

    if (!recording && !mediaStream) {
      return;
    }
    setRecordingUi(false);
    vscode.postMessage({ type: "recordingStopped" });

    try {
      if (processor) {
        processor.disconnect();
        processor.onaudioprocess = null;
      }
      if (source) {
        source.disconnect();
      }
      if (audioContext) {
        audioContext.close();
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
    } catch (_) {
      // ignore
    }

    processor = null;
    source = null;
    audioContext = null;
    mediaStream = null;

    if (!buffers.length) {
      vscode.postMessage({ type: "error", message: "No audio captured." });
      return;
    }

    const merged = mergeBuffers(buffers);
    buffers.length = 0;
    const wav = encodeWav(downsampleTo16k(merged, sampleRate), 16000);
    const base64Wav = arrayBufferToBase64(wav);
    vscode.postMessage({ type: "audio", base64Wav: base64Wav });
  }

  function mergeBuffers(chunks) {
    let len = 0;
    for (let i = 0; i < chunks.length; i++) {
      len += chunks[i].length;
    }
    const result = new Float32Array(len);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      result.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return result;
  }

  function downsampleTo16k(input, inRate) {
    if (inRate === 16000) {
      return input;
    }
    const ratio = inRate / 16000;
    const newLen = Math.round(input.length / ratio);
    const result = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const idx = Math.floor(i * ratio);
      result[i] = input[idx];
    }
    return result;
  }

  function encodeWav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);
    floatTo16BitPCM(view, 44, samples);
    return buffer;
  }

  function floatTo16BitPCM(view, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function sendTranscript() {
    const text = (transcriptEdit.value || "").trim();
    lastTranscript = text;
    setReviewUi(false);
    setText(transcriptEl, text, !text);
    vscode.postMessage({ type: "sendTranscript", text: text });
  }

  micBtn.addEventListener("click", () => {
    if (recording) {
      stopRecording();
    } else if (nativeMode) {
      vscode.postMessage({ type: "requestNative" });
    } else {
      vscode.postMessage({ type: "toggle" });
    }
  });

  typeBtn.addEventListener("click", () => {
    setReviewUi(true, lastTranscript || "");
    vscode.postMessage({ type: "typePrompt", text: lastTranscript || "" });
  });

  cancelBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "cancel" });
  });

  sendBtn.addEventListener("click", () => {
    sendTranscript();
  });

  discardBtn.addEventListener("click", () => {
    const text = (transcriptEdit.value || "").trim();
    setReviewUi(false);
    setText(transcriptEl, "", true);
    vscode.postMessage({ type: "discardTranscript", text: text });
  });

  showHistoryBtn.addEventListener("click", () => {
    historyOffset = 0;
    openHistory(true);
  });

  hideHistoryBtn.addEventListener("click", () => {
    historyOpen = false;
    showHistoryBtn.classList.remove("hidden");
    hideHistoryBtn.classList.add("hidden");
    historyActions.classList.add("hidden");
    loadMoreHistoryBtn.classList.add("hidden");
    historyEl.classList.add("empty");
    historyEl.textContent = "Click Show transcripts to list recent inputs.";
    delete historyEl.dataset.loaded;
  });

  loadMoreHistoryBtn.addEventListener("click", () => {
    openHistory(false);
  });

  historyEl.addEventListener("click", (event) => {
    const item = event.target.closest(".hist-item");
    if (!item || !item.dataset.transcript) {
      return;
    }
    const text = item.dataset.transcript;
    lastTranscript = text;
    setReviewUi(true, text);
    vscode.postMessage({ type: "reuseHistory", text: text });
  });

  copyBtn.addEventListener("click", () => {
    void copyText(lastResultText || resultEl.textContent || "");
  });

  copyTranscriptBtn.addEventListener("click", () => {
    const text = reviewMode
      ? transcriptEdit.value || ""
      : lastTranscript || transcriptEl.textContent || "";
    void copyText(text === "—" ? "" : text);
  });

  copyIntentBtn.addEventListener("click", () => {
    const parts = [];
    if (lastIntentMeta && lastIntentMeta !== "—") {
      parts.push(lastIntentMeta);
    }
    if (lastSummary && lastSummary !== "—") {
      parts.push(lastSummary);
    }
    void copyText(parts.join("\n"));
  });

  langBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "cycleLanguage" });
  });

  alwaysApproveBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "toggleAlwaysApprove" });
  });

  workspaceSelect.addEventListener("change", () => {
    vscode.postMessage({
      type: "selectWorkspace",
      path: workspaceSelect.value || "",
    });
  });

  retryBtn.addEventListener("click", () => {
    if (lastTranscript) {
      vscode.postMessage({ type: "sendTranscript", text: lastTranscript });
    } else {
      setReviewUi(true, "");
    }
  });

  transcriptEdit.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      sendTranscript();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) {
      return;
    }
    if (msg.type === "startRecording") {
      nativeMode = false;
      if (typeof msg.autoStopMs === "number") {
        autoStopMs = msg.autoStopMs;
      }
      startRecording();
    } else if (msg.type === "stopRecording") {
      stopRecording();
    } else if (msg.type === "nativeRecording") {
      nativeMode = !!msg.active;
      if (typeof msg.autoStopMs === "number") {
        autoStopMs = msg.autoStopMs;
      }
      if (msg.active) {
        setRecordingUi(true);
        // Host owns native auto-stop timer; still show countdown label.
        armAutoStop(autoStopMs);
      } else {
        clearAutoStop();
        setRecordingUi(false);
      }
    } else if (msg.type === "plan") {
      planBadge.textContent = msg.plan || "free";
      planBadge.classList.toggle("pro", msg.plan === "pro");
    } else if (msg.type === "settings") {
      applySettings(msg);
    } else if (msg.type === "progress") {
      renderProgress(msg.steps || [], msg.current || "");
    } else if (msg.type === "historyPage") {
      historyPro = msg.pro !== false;
      historyTotal = typeof msg.total === "number" ? msg.total : historyTotal;
      historyHasMore = !!msg.hasMore;
      const items = msg.items || [];
      if (msg.reset) {
        historyOffset = 0;
        renderHistoryItems(items, false);
        historyOffset = items.length;
        historyOpen = true;
        showHistoryBtn.classList.add("hidden");
        hideHistoryBtn.classList.remove("hidden");
        historyActions.classList.remove("hidden");
        historyEl.dataset.loaded = "1";
      } else {
        renderHistoryItems(items, true);
        historyOffset += items.length;
      }
      setHistoryUi(historyPro, historyTotal);
      if (historyOpen && historyHasMore) {
        loadMoreHistoryBtn.classList.remove("hidden");
      } else {
        loadMoreHistoryBtn.classList.add("hidden");
      }
      if (msg.reset && historyTotal === 0 && historyPro) {
        historyEl.classList.add("empty");
        historyEl.textContent = "No transcripts yet.";
      }
    } else if (msg.type === "state" && msg.state) {
      const s = msg.state;
      statusEl.textContent = s.status || "idle";
      setBusyUi(
        s.status === "routing" ||
          s.status === "running" ||
          s.status === "transcribing"
      );

      if (s.status !== "running" && s.status !== "routing") {
        if (s.status === "done" || s.status === "error" || s.status === "idle") {
          // keep last progress visible briefly on done; hide on idle/error
          if (s.status === "idle" || s.status === "error") {
            renderProgress([], "");
          }
        }
      }

      if (s.plan) {
        planBadge.textContent = s.plan;
        planBadge.classList.toggle("pro", s.plan === "pro");
      }

      if (
        typeof s.historyPro === "boolean" ||
        typeof s.historyTotal === "number"
      ) {
        setHistoryUi(
          typeof s.historyPro === "boolean" ? s.historyPro : historyPro,
          typeof s.historyTotal === "number" ? s.historyTotal : historyTotal
        );
      }

      if (s.status === "review") {
        setReviewUi(true, s.transcript || "");
        lastTranscript = s.transcript || "";
      } else {
        if (reviewMode && s.status !== "routing" && s.status !== "running") {
          setReviewUi(false);
        } else if (
          s.status === "routing" ||
          s.status === "running" ||
          s.status === "done"
        ) {
          setReviewUi(false);
          setText(transcriptEl, s.transcript, !s.transcript);
          lastTranscript = s.transcript || lastTranscript;
        } else if (s.status !== "review") {
          setText(transcriptEl, s.transcript, !s.transcript);
        }
      }

      if (s.intent) {
        lastIntentMeta =
          s.intent +
          (s.confidence
            ? " · confidence " + (s.confidence * 100).toFixed(0) + "%"
            : "");
        intentMetaEl.textContent = lastIntentMeta;
      } else {
        lastIntentMeta = "";
        intentMetaEl.textContent = "—";
      }
      lastSummary = s.summary || "";
      setText(summaryEl, s.summary, !s.summary);

      lastResultText = s.result || "";
      if (s.resultHtml) {
        setHtml(resultEl, s.resultHtml, !s.resultHtml);
      } else {
        setText(resultEl, s.result, !s.result);
      }

      if (s.error) {
        errorCard.classList.remove("hidden");
        errorEl.textContent = s.error;
      } else {
        errorCard.classList.add("hidden");
        errorEl.textContent = "";
      }
      if (s.status === "recording") {
        setRecordingUi(true);
      } else if (s.status !== "idle") {
        if (!recording) {
          clearAutoStop();
          micLabel.textContent = "Click to talk";
          micBtn.classList.remove("recording");
        }
      }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
