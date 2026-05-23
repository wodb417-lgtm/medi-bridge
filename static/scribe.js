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

  var RESET_LABEL_IDLE = "🔄 진료 종료 및 화면 초기화";
  var RESET_LABEL_END_SESSION = "🔄 진료 종료 및 화면 초기화 (다음 환자 받기)";
  var BRIEFING_PLACEHOLDER =
    "마이크로 진료 대화를 녹음한 뒤 「진료 요약 생성」을 누르면\n" +
    "🚨 의사 지시 및 고지사항이 포함된 차트 요약이 이곳에 표시됩니다.";
  var SUMMARY_BTN_DEFAULT = "📝 진료 요약 생성";
  var SUMMARY_BTN_LOADING = "요약 생성 중…";

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

  function setConnectionStatus(state, text) {
    connectionStatus.className = "status-badge";
    if (state === "warn") connectionStatus.classList.add("status-badge--warn");
    else if (state === "error") connectionStatus.classList.add("status-badge--error");
    connectionStatusText.textContent = text;
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
        ? "녹음 중..."
        : btn.getAttribute("data-default-label") || labelEl.textContent;
    }
  }

  function setPatientRecordingButton(btn, recording) {
    btn.classList.toggle("is-recording", recording);
    btn.setAttribute("aria-pressed", recording ? "true" : "false");
    var labelEl = btn.querySelector(".speak-btn__label");
    if (!labelEl) return;
    labelEl.textContent = recording
      ? btn.getAttribute("data-recording-label") || "말하기 종료"
      : btn.getAttribute("data-default-label") || "환자 말하기";
  }

  function setSessionResetNudge(active) {
    if (!btnReset) return;
    btnReset.classList.toggle("reset-btn--session-nudge", !!active);
    if (btnResetLabel) {
      btnResetLabel.textContent = active ? RESET_LABEL_END_SESSION : RESET_LABEL_IDLE;
    }
    btnReset.setAttribute(
      "aria-label",
      active
        ? "진료 종료 및 화면 초기화 — 다음 환자 받기"
        : "진료 종료 및 화면 초기화"
    );
  }

  function clearBriefing() {
    latestSummaryText = "";
    if (briefingContent) {
      briefingContent.innerHTML = "";
      briefingContent.hidden = true;
    }
    if (briefingPlaceholder) {
      briefingPlaceholder.textContent = BRIEFING_PLACEHOLDER;
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
      briefingPlaceholder.textContent = "AI가 진료 요약을 작성하고 있습니다…";
      return;
    }
    if (!latestSummaryText.trim()) {
      briefingPlaceholder.textContent = BRIEFING_PLACEHOLDER;
      briefingPlaceholder.hidden = false;
      briefingContent.hidden = true;
      briefingBody.classList.add("is-placeholder");
    }
  }

  function renderTranscriptMini() {
    if (!transcriptMini) return;
    if (!conversationHistory.length) {
      transcriptMini.textContent = "녹음된 대화가 없습니다. 의사/환자 말하기로 대화를 쌓아 주세요.";
      return;
    }
    transcriptMini.innerHTML = conversationHistory
      .map(function (turn, i) {
        var who = turn.speaker === "doctor" ? "의사" : "환자";
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
      doctorText.textContent = "의사 발화가 여기에 표시됩니다";
      doctorText.classList.add("is-empty");
    }
    if (patientText) {
      patientText.textContent = "환자 발화가 여기에 표시됩니다";
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
      throw new Error("서버와 연결되어 있지 않습니다.");
    }
    ws.send(JSON.stringify(payload));
  }

  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    if (wsConnectPromise) return wsConnectPromise;

    wsConnectPromise = new Promise(function (resolve, reject) {
      setConnectionStatus("warn", "서버 연결 중…");
      var socket = new WebSocket(WS_URL);
      socket.onopen = function () {
        ws = socket;
        wsConnectPromise = null;
        sendMeta({ type: "register", role: "doctor" });
        setConnectionStatus("ok", "서버 연결됨");
        resolve(socket);
      };
      socket.onmessage = function (event) {
        handleServerMessage(JSON.parse(event.data));
      };
      socket.onerror = function () {
        setConnectionStatus("error", "서버 연결 실패");
        reject(new Error("WebSocket failed"));
      };
      socket.onclose = function () {
        ws = null;
        wsConnectPromise = null;
        setConnectionStatus("warn", "연결 끊김 · 재연결 중…");
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
      return Promise.reject(new Error("녹음된 오디오가 없습니다."));
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
              (body && body.detail) || res.statusText || "전송 실패"
            );
          })
          .catch(function () {
            throw new Error(res.statusText || "전송 실패");
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
          alert(err.message || "전송 실패");
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
      alert("서버 연결 실패");
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
      if (label) label.textContent = loading ? SUMMARY_BTN_LOADING : SUMMARY_BTN_DEFAULT;
    }
  }

  function requestSummary() {
    if (isSummaryInProgress) return;
    if (!conversationHistory.length) {
      alert("요약할 대화가 없습니다. 먼저 진료 대화를 녹음해 주세요.");
      return;
    }
    setSummaryLoading(true);
    connectWebSocket()
      .then(function () {
        sendMeta({ type: "request_summary", history: conversationHistory });
      })
      .catch(function () {
        setSummaryLoading(false);
        alert("서버 연결 실패");
      });
  }

  function copyBriefing() {
    if (!latestSummaryText.trim()) {
      alert("복사할 요약이 없습니다.");
      return;
    }
    navigator.clipboard
      .writeText(latestSummaryText)
      .then(function () {
        alert("차트 요약본이 클립보드에 복사되었습니다. (Ctrl+V)");
      })
      .catch(function (err) {
        alert("복사 실패: " + (err.message || err));
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
        alert(msg.error || "요약 결과가 비어 있습니다.");
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
      alert(msg.message || "오류가 발생했습니다.");
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
      alert(err.message || "마이크 오류");
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
      if (!confirm("현재 진료 기록을 초기화하시겠습니까?")) return;
      connectWebSocket()
        .then(function () {
          sendMeta({ type: "reset" });
          clearSession();
        })
        .catch(function () {
          alert("서버 연결 실패");
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
})();
