/**
 * MediBridge — 내국인 AI 서기 모드 (scribe.html)
 */
(function () {
  "use strict";

  var WS_URL = MediBridgeWs.getWebSocketUrl();

  var briefingBody = document.getElementById("scribe-briefing-body");
  var briefingPlaceholder = document.getElementById("scribe-briefing-placeholder");
  var briefingContent = document.getElementById("scribe-briefing-content");
  var transcriptMini = document.getElementById("scribe-transcript-mini");
  var doctorText = document.getElementById("doctor-text");
  var patientText = document.getElementById("patient-text");
  var btnDoctor = document.getElementById("btn-doctor");
  var btnPatient = document.getElementById("btn-patient");
  var btnSummary = document.getElementById("btn-summary");
  var btnReset = document.getElementById("btn-reset");
  var btnResetLabel = document.getElementById("btn-reset-label");
  var btnChartCopy = document.getElementById("btn-chart-copy");
  var connectionStatus = document.getElementById("connection-status");
  var connectionStatusText = document.getElementById("connection-status-text");
  var micAlert = document.getElementById("mic-alert");
  var panelsProcessing = document.getElementById("panels-processing");
  var panelsPatientRemote = document.getElementById("panels-patient-remote");

  var connectionStatusKey = "status.connecting";
  var connectionStatusState = "warn";
  var sessionResetNudging = false;

  var conversationHistory = [];
  var latestSummaryText = "";
  var isSummaryInProgress = false;

  var ws = null;
  var wsConnectPromise = null;
  var mediaRecorder = null;
  var audioStream = null;
  var activeSpeaker = null;
  var activeButton = null;
  var isRecording = false;
  var isProcessing = false;
  var isPatientRecording = false;
  var patientSpeakMirrored = false;
  var recordedChunks = [];
  var recordingMime = "audio/webm";

  var DOSE_HIGHLIGHT_STYLE =
    "color: #e74c3c; font-weight: bold; background-color: #fee2e2; padding: 0 4px; border-radius: 4px;";
  var DOSE_HIGHLIGHT_RE =
    /(\d+(?:\.\d+)?(?:일분|일치|주일|개월|시간|분|회|정|알|캡슐|포|통|mg|mL|ml|년|일|주|번|시)?|\d+(?:\.\d+)?|(?:일분|일치|주일|개월|시간|캡슐|mg|mL|ml|회|정|알|포|통))/gi;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightPrescriptionDoses(text) {
    return escapeHtml(text).replace(DOSE_HIGHLIGHT_RE, function (match) {
      return '<span style="' + DOSE_HIGHLIGHT_STYLE + '">' + match + "</span>";
    });
  }

  function formatBriefingHtml(text) {
    var lines = String(text).split(/\r?\n/);
    var html = "";
    var alertLines = [];
    var otherLines = [];
    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) {
        otherLines.push("");
        return;
      }
      if (
        /^🚨/.test(trimmed) ||
        (/의사 지시/.test(trimmed) && /고지/.test(trimmed))
      ) {
        alertLines.push(trimmed);
      } else {
        otherLines.push(trimmed);
      }
    });
    if (alertLines.length) {
      html +=
        '<div class="briefing-alert-block">' +
        highlightPrescriptionDoses(alertLines.join("\n")) +
        "</div>";
    }
    var bodyText = otherLines.join("\n").trim();
    if (bodyText) {
      html += highlightPrescriptionDoses(bodyText);
    }
    return html || highlightPrescriptionDoses(text);
  }

  function setPanelText(el, text) {
    if (!el) return;
    var t = (text || "").trim();
    el.textContent = t || el.getAttribute("data-placeholder") || "";
    el.classList.toggle("is-empty", !t);
  }

  function setConnectionStatus(state, key) {
    connectionStatusState = state;
    connectionStatusKey = key;
    connectionStatus.className = "status-badge";
    if (state === "warn") connectionStatus.classList.add("status-badge--warn");
    else if (state === "error") connectionStatus.classList.add("status-badge--error");
    connectionStatusText.textContent = MbLang.t(key);
  }

  function showMicAlert() {
    micAlert.classList.add("is-visible");
  }

  function hideMicAlert() {
    micAlert.classList.remove("is-visible");
  }

  function showProcessingOverlay() {
    panelsProcessing.classList.add("is-visible");
    panelsProcessing.setAttribute("aria-hidden", "false");
  }

  function hideProcessingOverlay() {
    panelsProcessing.classList.remove("is-visible");
    panelsProcessing.setAttribute("aria-hidden", "true");
  }

  function showPatientRemoteOverlay() {
    if (!panelsPatientRemote) return;
    hideProcessingOverlay();
    panelsPatientRemote.classList.add("is-visible");
    panelsPatientRemote.setAttribute("aria-hidden", "false");
  }

  function hidePatientRemoteOverlay() {
    if (!panelsPatientRemote) return;
    panelsPatientRemote.classList.remove("is-visible");
    panelsPatientRemote.setAttribute("aria-hidden", "true");
  }

  function setRecordingButton(btn, recording) {
    btn.classList.toggle("is-recording", recording);
    btn.setAttribute("aria-pressed", recording ? "true" : "false");
    var labelEl = btn.querySelector(".speak-btn__label");
    if (labelEl) {
      labelEl.textContent = recording
        ? MbLang.t("doctor.recording")
        : btn.getAttribute("data-default-label") || MbLang.t("doctor.speak");
    }
  }

  function setPatientRecordingButton(btn, recording) {
    btn.classList.toggle("is-recording", recording);
    btn.setAttribute("aria-pressed", recording ? "true" : "false");
    var labelEl = btn.querySelector(".speak-btn__label");
    if (!labelEl) return;
    labelEl.textContent = recording
      ? btn.getAttribute("data-recording-label") || MbLang.t("doctor.stop")
      : btn.getAttribute("data-default-label") || MbLang.t("doctor.patientSpeak");
  }

  function setSessionResetNudge(active) {
    if (!btnReset) return;
    sessionResetNudging = !!active;
    btnReset.classList.toggle("reset-btn--session-nudge", sessionResetNudging);
    if (btnResetLabel) {
      btnResetLabel.textContent = MbLang.t(sessionResetNudging ? "reset.nudge" : "reset.idle");
    }
    btnReset.setAttribute(
      "aria-label",
      MbLang.t(sessionResetNudging ? "reset.ariaNudge" : "reset.aria")
    );
  }

  function clearBriefing() {
    latestSummaryText = "";
    if (briefingContent) {
      briefingContent.innerHTML = "";
      briefingContent.hidden = true;
    }
    if (briefingPlaceholder) {
      briefingPlaceholder.textContent = MbLang.t("scribe.placeholder");
      briefingPlaceholder.hidden = false;
    }
    if (briefingBody) briefingBody.classList.add("is-placeholder");
    if (btnChartCopy) btnChartCopy.disabled = true;
    setSessionResetNudge(false);
  }

  function setBriefingSummary(text) {
    latestSummaryText = (text || "").trim();
    if (!latestSummaryText) {
      clearBriefing();
      return;
    }
    if (briefingContent) {
      briefingContent.innerHTML = formatBriefingHtml(latestSummaryText);
      briefingContent.hidden = false;
    }
    if (briefingPlaceholder) briefingPlaceholder.hidden = true;
    if (briefingBody) briefingBody.classList.remove("is-placeholder");
    if (btnChartCopy) btnChartCopy.disabled = false;
    if (briefingBody) briefingBody.scrollTop = 0;
    setSessionResetNudge(true);
  }

  function setBriefingLoading(loading) {
    if (!briefingPlaceholder || !briefingContent) return;
    if (loading) {
      briefingBody.classList.add("is-placeholder");
      briefingContent.hidden = true;
      briefingPlaceholder.hidden = false;
      briefingPlaceholder.textContent = MbLang.t("scribe.writing");
      return;
    }
    if (!latestSummaryText.trim()) {
      briefingPlaceholder.textContent = MbLang.t("scribe.placeholder");
      briefingPlaceholder.hidden = false;
      briefingContent.hidden = true;
      briefingBody.classList.add("is-placeholder");
    }
  }

  function renderTranscriptMini() {
    if (!transcriptMini) return;
    if (!conversationHistory.length) {
      transcriptMini.textContent = MbLang.t("scribe.emptyLog");
      return;
    }
    transcriptMini.innerHTML = conversationHistory
      .map(function (turn, i) {
        var who = turn.speaker === "doctor" ? MbLang.t("scribe.whoDoctor") : MbLang.t("scribe.whoPatient");
        var line =
          turn.speaker === "doctor"
            ? turn.doctor_text
            : turn.patient_text || turn.doctor_text;
        return "<div>#" + (i + 1) + " " + who + ": " + escapeHtml(line) + "</div>";
      })
      .join("");
  }

  function clearSession() {
    conversationHistory = [];
    setPanelText(doctorText, "");
    setPanelText(patientText, "");
    if (doctorText) {
      doctorText.textContent = MbLang.t("scribe.doctorEmpty");
      doctorText.classList.add("is-empty");
    }
    if (patientText) {
      patientText.textContent = MbLang.t("scribe.patientEmpty");
      patientText.classList.add("is-empty");
    }
    renderTranscriptMini();
    clearBriefing();
  }

  function appendTurn(msg) {
    if (!msg || msg.type !== "result") return;
    var doctorLine = (msg.doctor_text || msg.original || "").trim();
    var patientLine = (msg.patient_text || msg.translated || "").trim();
    if (!doctorLine && !patientLine) return;
    conversationHistory.push({
      speaker: msg.speaker || "unknown",
      doctor_text: doctorLine,
      patient_text: patientLine || doctorLine,
    });
    if (msg.speaker === "doctor") {
      setPanelText(doctorText, doctorLine);
    } else if (msg.speaker === "patient") {
      setPanelText(patientText, patientLine || doctorLine);
    }
    renderTranscriptMini();
  }

  function sendMeta(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(MbLang.t("status.offline"));
    }
    ws.send(JSON.stringify(payload));
  }

  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    if (wsConnectPromise) return wsConnectPromise;

    wsConnectPromise = new Promise(function (resolve, reject) {
      setConnectionStatus("warn", "status.connecting");
      var socket = new WebSocket(WS_URL);
      socket.onopen = function () {
        ws = socket;
        wsConnectPromise = null;
        sendMeta({ type: "register", role: "doctor" });
        setConnectionStatus("ok", "status.connected");
        resolve(socket);
      };
      socket.onmessage = function (event) {
        handleServerMessage(JSON.parse(event.data));
      };
      socket.onerror = function () {
        setConnectionStatus("error", "status.failed");
        reject(new Error("WebSocket failed"));
      };
      socket.onclose = function () {
        ws = null;
        wsConnectPromise = null;
        setConnectionStatus("warn", "status.reconnecting");
        setTimeout(function () {
          connectWebSocket().catch(function () {});
        }, 2000);
      };
    });
    return wsConnectPromise;
  }

  function sendStateChange(state, speaker) {
    var payload = { type: "state_change", state: state };
    if (speaker) payload.speaker = speaker;
    return connectWebSocket().then(function () {
      sendMeta(payload);
    });
  }

  function extensionForMime(mime) {
    if (!mime) return "webm";
    if (mime.indexOf("webm") >= 0) return "webm";
    if (mime.indexOf("mp4") >= 0) return "mp4";
    if (mime.indexOf("ogg") >= 0) return "ogg";
    return "webm";
  }

  function getSupportedMimeType() {
    if (window.MediBridgeClinicAudio && MediBridgeClinicAudio.getSupportedClinicMimeType) {
      return MediBridgeClinicAudio.getSupportedClinicMimeType();
    }
    var types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  function getClinicMicConstraints() {
    if (window.MediBridgeClinicAudio && MediBridgeClinicAudio.getClinicAudioConstraints) {
      return MediBridgeClinicAudio.getClinicAudioConstraints();
    }
    return { audio: { channelCount: 1, sampleRate: { ideal: 16000 } } };
  }

  function createClinicMediaRecorder(stream, mimeType) {
    if (window.MediBridgeClinicAudio && MediBridgeClinicAudio.createMediaRecorder) {
      return MediBridgeClinicAudio.createMediaRecorder(stream, mimeType);
    }
    try {
      return mimeType
        ? new MediaRecorder(stream, { mimeType: mimeType, audioBitsPerSecond: 24000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
    } catch (e) {
      return mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
    }
  }

  function submitAudio(blob, speaker) {
    if (!blob || blob.size === 0) {
      return Promise.reject(new Error(MbLang.t("status.noAudio")));
    }
    var formData = new FormData();
    var ext = extensionForMime(recordingMime);
    formData.append("audio", blob, "scribe_audio." + ext);
    formData.append("speaker", speaker);
    formData.append("mode", "scribe");
    return fetch("/api/transcribe", { method: "POST", body: formData }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .then(function (body) {
            throw new Error(
              (body && body.detail) || res.statusText || MbLang.t("status.sendFailed")
            );
          })
          .catch(function () {
            throw new Error(res.statusText || MbLang.t("status.sendFailed"));
          });
      }
      return res.json();
    });
  }

  async function startDoctorRecording(btn) {
    if (isProcessing || isRecording) return;
    await connectWebSocket();
    activeSpeaker = "doctor";
    activeButton = btn;
    audioStream = await navigator.mediaDevices.getUserMedia(getClinicMicConstraints());
    var mimeType = getSupportedMimeType();
    recordingMime = mimeType || "audio/webm";
    recordedChunks = [];
    mediaRecorder = createClinicMediaRecorder(audioStream, mimeType || undefined);
    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size) recordedChunks.push(e.data);
    };
    mediaRecorder.start(250);
    isRecording = true;
    setRecordingButton(btn, true);
    sendStateChange("doctor_speaking", "doctor").catch(function () {});
  }

  function stopDoctorRecording() {
    if (!mediaRecorder || !isRecording || activeSpeaker !== "doctor") return;
    isRecording = false;
    isProcessing = true;
    if (activeButton) setRecordingButton(activeButton, false);
    showProcessingOverlay();
    var recorder = mediaRecorder;
    mediaRecorder = null;
    recorder.onstop = function () {
      if (audioStream) {
        audioStream.getTracks().forEach(function (t) {
          t.stop();
        });
        audioStream = null;
      }
      var blob = new Blob(recordedChunks.slice(), { type: recordingMime });
      recordedChunks = [];
      sendStateChange("processing", "doctor")
        .catch(function () {})
        .finally(function () {
          return submitAudio(blob, "doctor");
        })
        .catch(function (err) {
          isProcessing = false;
          activeSpeaker = null;
          activeButton = null;
          hideProcessingOverlay();
          alert(err.message || MbLang.t("status.sendFailed"));
        });
    };
    if (recorder.state !== "inactive") recorder.stop();
  }

  function startPatientRemoteRecording(btn) {
    isPatientRecording = true;
    activeSpeaker = "patient";
    activeButton = btn;
    setPatientRecordingButton(btn, true);
    showPatientRemoteOverlay();
    sendStateChange("patient_speaking", "patient").catch(function () {
      isPatientRecording = false;
      activeSpeaker = null;
      activeButton = null;
      setPatientRecordingButton(btn, false);
      hidePatientRemoteOverlay();
      alert(MbLang.t("status.failed"));
    });
  }

  function stopPatientRemoteRecording(btn) {
    if (!isPatientRecording) return;
    isPatientRecording = false;
    hidePatientRemoteOverlay();
    setPatientRecordingButton(btn, false);
    sendStateChange("processing", "patient").catch(function () {});
    activeSpeaker = null;
    activeButton = null;
  }

  function togglePatientRemoteRecording(btn) {
    if (isProcessing || isRecording) return;
    if (!isPatientRecording) startPatientRemoteRecording(btn);
    else stopPatientRemoteRecording(btn);
  }

  function setSummaryLoading(loading) {
    isSummaryInProgress = loading;
    setBriefingLoading(loading);
    if (btnSummary) {
      btnSummary.disabled = loading;
      var label = btnSummary.querySelector(".summary-btn__label");
      if (label) label.textContent = loading ? MbLang.t("scribe.summaryLoading") : MbLang.t("scribe.summary");
    }
  }

  function requestSummary() {
    if (isSummaryInProgress) return;
    if (!conversationHistory.length) {
      alert(MbLang.t("scribe.noConversation"));
      return;
    }
    setSummaryLoading(true);
    connectWebSocket()
      .then(function () {
        sendMeta({ type: "request_summary", history: conversationHistory });
      })
      .catch(function () {
        setSummaryLoading(false);
        alert(MbLang.t("status.failed"));
      });
  }

  function copyBriefing() {
    if (!latestSummaryText.trim()) {
      alert(MbLang.t("scribe.noCopy"));
      return;
    }
    navigator.clipboard
      .writeText(latestSummaryText)
      .then(function () {
        alert(MbLang.t("scribe.copied"));
      })
      .catch(function (err) {
        alert(MbLang.t("scribe.copyFailed") + " " + (err.message || err));
      });
  }

  function handleServerMessage(msg) {
    if (msg.type === "registered" || msg.type === "ready" || msg.type === "pong") return;

    if (msg.type === "reset") {
      isProcessing = false;
      isPatientRecording = false;
      hidePatientRemoteOverlay();
      hideProcessingOverlay();
      clearSession();
      if (btnPatient) setPatientRecordingButton(btnPatient, false);
      return;
    }

    if (msg.type === "summary_result") {
      setSummaryLoading(false);
      var text = (msg.text && String(msg.text).trim()) || "";
      if (!text) {
        alert(msg.error || MbLang.t("scribe.emptySummary"));
        return;
      }
      setBriefingSummary(text);
      return;
    }

    if (msg.status === "translating" || msg.type === "processing") {
      isProcessing = true;
      showProcessingOverlay();
      return;
    }

    if (msg.type === "status") {
      if (msg.status === "ready") {
        isProcessing = false;
        isPatientRecording = false;
        hidePatientRemoteOverlay();
        hideProcessingOverlay();
        if (btnPatient) setPatientRecordingButton(btnPatient, false);
      } else if (msg.status === "processing") {
        isProcessing = true;
        showProcessingOverlay();
      }
      return;
    }

    if (msg.type === "error") {
      setSummaryLoading(false);
      isProcessing = false;
      hideProcessingOverlay();
      alert(msg.message || MbLang.t("scribe.genericError"));
      return;
    }

    if (msg.type === "result") {
      isProcessing = false;
      hideProcessingOverlay();
      appendTurn(msg);
    }
  }

  function beginDoctorSpeak(btn) {
    if (isProcessing) return;
    startDoctorRecording(btn).catch(function (err) {
      isRecording = false;
      setRecordingButton(btn, false);
      alert(err.message || MbLang.t("scribe.micError"));
    });
  }

  function endDoctorSpeak() {
    if (isRecording && activeSpeaker === "doctor") stopDoctorRecording();
  }

  function bindEvents() {
    btnDoctor.onmousedown = function (e) {
      e.preventDefault();
      beginDoctorSpeak(btnDoctor);
    };
    window.onmouseup = endDoctorSpeak;
    btnPatient.onclick = function (e) {
      e.preventDefault();
      togglePatientRemoteRecording(btnPatient);
    };
    if (btnSummary) btnSummary.onclick = requestSummary;
    if (btnChartCopy) btnChartCopy.onclick = copyBriefing;
    btnReset.onclick = function () {
      if (!confirm(MbLang.t("doctor.resetConfirm"))) return;
      connectWebSocket()
        .then(function () {
          sendMeta({ type: "reset" });
          clearSession();
        })
        .catch(function () {
          alert(MbLang.t("status.failed"));
        });
    };
  }

  connectWebSocket().catch(function () {});
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(function (s) {
      s.getTracks().forEach(function (t) {
        t.stop();
      });
      hideMicAlert();
    })
    .catch(showMicAlert);

  renderTranscriptMini();
  bindEvents();

  MbLang.onChange(function () {
    setConnectionStatus(connectionStatusState, connectionStatusKey);
    setSessionResetNudge(sessionResetNudging);
    if (doctorText && doctorText.classList.contains("is-empty")) {
      doctorText.textContent = MbLang.t("scribe.doctorEmpty");
    }
    if (patientText && patientText.classList.contains("is-empty")) {
      patientText.textContent = MbLang.t("scribe.patientEmpty");
    }
    renderTranscriptMini();
    if (btnDoctor) setRecordingButton(btnDoctor, isRecording && activeSpeaker === "doctor");
    if (btnPatient) setPatientRecordingButton(btnPatient, isPatientRecording);
    if (btnSummary) {
      var label = btnSummary.querySelector(".summary-btn__label");
      if (label) {
        label.textContent = isSummaryInProgress
          ? MbLang.t("scribe.summaryLoading")
          : MbLang.t("scribe.summary");
      }
    }
    if (briefingPlaceholder && !briefingPlaceholder.hidden && !latestSummaryText) {
      briefingPlaceholder.textContent = isSummaryInProgress
        ? MbLang.t("scribe.writing")
        : MbLang.t("scribe.placeholder");
    }
  });
})();
