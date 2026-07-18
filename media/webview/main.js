(function () {
  const vscode = acquireVsCodeApi();

  const micBtn = document.getElementById("micBtn");
  const micLabel = document.getElementById("micLabel");
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const transcriptEdit = document.getElementById("transcriptEdit");
  const reviewActions = document.getElementById("reviewActions");
  const sendBtn = document.getElementById("sendBtn");
  const discardBtn = document.getElementById("discardBtn");
  const intentMetaEl = document.getElementById("intentMeta");
  const summaryEl = document.getElementById("summary");
  const resultEl = document.getElementById("result");
  const errorCard = document.getElementById("errorCard");
  const errorEl = document.getElementById("error");

  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let source = null;
  let recording = false;
  let nativeMode = false;
  let reviewMode = false;
  const buffers = [];
  let sampleRate = 48000;

  function setText(el, text, empty) {
    el.textContent = text || "—";
    el.classList.toggle("empty", !!empty || !text);
  }

  function setRecordingUi(on) {
    recording = on;
    micBtn.classList.toggle("recording", on);
    micLabel.textContent = on ? "Listening… click to stop" : "Click to talk";
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

  async function startRecording() {
    if (recording) {
      return;
    }
    if (nativeMode) {
      setRecordingUi(true);
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
      vscode.postMessage({ type: "recordingStarted" });
    } catch (err) {
      setRecordingUi(false);
      vscode.postMessage({
        type: "micFailed",
        message: err && err.message ? err.message : String(err),
      });
    }
  }

  function stopRecording() {
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

  sendBtn.addEventListener("click", () => {
    sendTranscript();
  });

  discardBtn.addEventListener("click", () => {
    setReviewUi(false);
    setText(transcriptEl, "", true);
    vscode.postMessage({ type: "discardTranscript" });
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
      startRecording();
    } else if (msg.type === "stopRecording") {
      stopRecording();
    } else if (msg.type === "nativeRecording") {
      nativeMode = !!msg.active;
      setRecordingUi(!!msg.active);
    } else if (msg.type === "state" && msg.state) {
      const s = msg.state;
      statusEl.textContent = s.status || "idle";

      if (s.status === "review") {
        setReviewUi(true, s.transcript || "");
      } else {
        if (reviewMode && s.status !== "routing" && s.status !== "running") {
          setReviewUi(false);
        } else if (s.status === "routing" || s.status === "running" || s.status === "done") {
          setReviewUi(false);
          setText(transcriptEl, s.transcript, !s.transcript);
        } else if (s.status !== "review") {
          setText(transcriptEl, s.transcript, !s.transcript);
        }
      }

      if (s.intent) {
        intentMetaEl.textContent =
          s.intent +
          (s.confidence ? ` · confidence ${(s.confidence * 100).toFixed(0)}%` : "");
      } else {
        intentMetaEl.textContent = "—";
      }
      setText(summaryEl, s.summary, !s.summary);
      setText(resultEl, s.result, !s.result);
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
          micLabel.textContent = "Click to talk";
          micBtn.classList.remove("recording");
        }
      }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
