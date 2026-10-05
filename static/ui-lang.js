/**
 * MediBridge UI language. English is the default for portfolio viewers.
 * Choice is stored in localStorage and shared across screens.
 */
(function () {
  var STORAGE_KEY = "mb-ui-lang";
  var lang = "en";
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ko" || saved === "en") lang = saved;
  } catch (err) {}

  var STR = {
    en: {
      "portfolio.title": "MediBridge",
      "portfolio.brand": "For clinics in Korea",
      "portfolio.kicker": "",
      "portfolio.hero": "Two screens for a visit in a Korean clinic.",
      "portfolio.lead": "One screen interprets when the patient does not speak Korean. The other writes the chart note after a visit in Korean, and keeps the warnings the doctor gave at the top. The product screens are in Korean because that is the interface a clinic there would use. This page is in English so the three links below are easy to tell apart. The layout is still a working demo.",
      "portfolio.how": "How to try it",
      "portfolio.step1.title": "Open the clinician screen and the patient screen side by side.",
      "portfolio.step1.body": "Keep <a href=\"/doctor\">Interpreter</a> in this window. Open the <a href=\"/patient\">patient tablet</a> in another window, or on a tablet.",
      "portfolio.step2.title": "Press Speak as clinician and talk in Korean.",
      "portfolio.step2.body": "The translation shows up on the patient screen, and the audio plays one sentence at a time. Choose the patient’s language on the clinician screen.",
      "portfolio.step3.title": "Create the note on the scribe screen.",
      "portfolio.step3.body": "Record the visit on <a href=\"/scribe\">AI scribe</a>, then press Create visit note. Warnings and instructions the clinician gave are pinned at the top, in red.",
      "portfolio.screens": "Three screens",
      "portfolio.card1.role": "Clinician · patient speaks another language",
      "portfolio.card1.title": "Interpreter",
      "portfolio.card1.body": "The Korean line and the translation fill the screen. The tabs at the top switch you over to the scribe.",
      "portfolio.card1.link": "Open interpreter",
      "portfolio.card2.role": "Patient tablet",
      "portfolio.card2.title": "Patient screen",
      "portfolio.card2.body": "The patient only sees the translation and hears the audio. The clinician’s controls stay off this display.",
      "portfolio.card2.link": "Open patient screen",
      "portfolio.card3.role": "Clinician · visit in Korean",
      "portfolio.card3.title": "AI scribe",
      "portfolio.card3.body": "The live transcript stays narrow. The briefing takes the rest of the screen, with warnings and instructions at the top as a record of what was explained.",
      "portfolio.card3.link": "Open scribe",
      "portfolio.note": "Use the browser back button to return to this guide. Before the next patient, press End visit and clear the screen at the bottom.",

      "nav.aria": "Clinician mode",
      "nav.interpreter": "Interpreter",
      "nav.scribe": "AI scribe",
      "doctor.title": "MediBridge · Interpreter",
      "doctor.brand": "Interpreter · clinic controls",
      "doctor.settings": "Shortcut settings",
      "doctor.langLabel": "Patient language",
      "doctor.langHint": "The language locks as soon as you choose it, even before auto-detect.",
      "doctor.langPlaceholder": "Choose a language",
      "doctor.langAria": "Patient language",
      "doctor.stageAria": "Live interpretation",
      "doctor.panelDoctorAria": "Clinician, Korean",
      "doctor.panelDoctor": "Korean · clinician",
      "doctor.panelDoctorSub": "Korean record of what was said",
      "doctor.placeholder": "The Korean line will show up here",
      "doctor.panelPatientAria": "Patient translation preview",
      "doctor.panelPatient": "Other language · patient",
      "doctor.detectedLabel": "Detected language:",
      "doctor.panelPatientSub": "What the patient tablet will show",
      "doctor.patientPlaceholder": "The translation for the patient screen",
      "doctor.speak": "Speak as clinician",
      "doctor.patientSpeak": "Speak as patient",
      "doctor.stop": "Stop speaking",
      "doctor.recording": "Recording…",
      "doctor.patientTitleWait": "Patient (waiting to detect)",
      "doctor.patientSubWait": "Patient monitor is on the welcome screen",
      "doctor.patientTitleLocked": "Patient ({lang})",
      "doctor.manualLock": "set manually",
      "doctor.detectedLock": "detected from speech",
      "doctor.auto": "Auto-detect",
      "doctor.patientSpeaking": "Patient is speaking…",
      "doctor.settingsTitle": "Microphone shortcuts",
      "doctor.settingsDesc": "Click a field, then press the key you want.",
      "doctor.shortcutDoctor": "Clinician shortcut",
      "doctor.shortcutPatient": "Patient shortcut",
      "doctor.save": "Save",
      "doctor.close": "Close",
      "doctor.mic": "Allow the microphone to continue.",
      "doctor.resetConfirm": "Clear this visit and start fresh?",
      "doctor.micBlocked": "The microphone is blocked. Check the browser permission.",
      "doctor.sendFailed": "Could not send that.",
      "doctor.processError": "Something went wrong while processing.",

      "scribe.title": "MediBridge · AI scribe",
      "scribe.brand": "AI scribe · chart note",
      "scribe.banner": "Record the conversation on the left. The briefing on the right is the chart note. Anything the clinician warned about, or told the patient to do, is marked at the top. Before the next patient, end the visit and clear the screen.",
      "scribe.scriptAria": "Live transcript",
      "scribe.doctorAria": "Clinician",
      "scribe.doctor": "Clinician",
      "scribe.doctorSub": "Korean transcript",
      "scribe.doctorEmpty": "What the clinician says will show up here",
      "scribe.patientAria": "Patient",
      "scribe.patient": "Patient",
      "scribe.patientSub": "Korean transcript",
      "scribe.patientEmpty": "What the patient says will show up here",
      "scribe.briefingAria": "Visit briefing and chart note",
      "scribe.briefingTitle": "Visit briefing and chart note",
      "scribe.copy": "Copy",
      "scribe.copyAria": "Copy note",
      "scribe.placeholder": "Record the visit, then press Create visit note.\nWarnings and instructions show up at the top, in red.",
      "scribe.writing": "Writing the note…",
      "scribe.emptyLog": "Nothing recorded yet. Use Speak as clinician or Speak as patient.",
      "scribe.whoDoctor": "Clinician",
      "scribe.whoPatient": "Patient",
      "scribe.summary": "Create visit note",
      "scribe.summaryLoading": "Writing the note…",
      "scribe.summaryAria": "Create visit note",
      "scribe.noConversation": "There is nothing to summarize yet. Record the visit first.",
      "scribe.noCopy": "There is no note to copy yet.",
      "scribe.copied": "The note is on your clipboard.",
      "scribe.copyFailed": "Could not copy.",
      "scribe.emptySummary": "The note came back empty.",
      "scribe.genericError": "Something went wrong.",
      "scribe.micError": "Microphone error.",

      "patient.title": "MediBridge · Patient display",
      "patient.brand": "Patient display · read only",
      "patient.screenAria": "Patient translation",
      "patient.speakNow": "Speak now",
      "patient.listening": "Listening",
      "patient.translating": "Translating",
      "patient.oneMoment": "One moment",
      "patient.unlockTitle": "MediBridge patient monitor",
      "patient.unlockDesc": "Tap once at the start of the day. This turns on the speaker and microphone, and translations play on their own after that.",
      "patient.unlock": "Connect speaker and microphone",
      "patient.welcome": "Tell us your symptoms in whichever language is easiest.",
      "patient.detectedLabel": "Detected language:",
      "patient.subtitleAria": "Translation",
      "patient.placeholder": "The translation will show up here",
      "patient.start": "Start speaking",
      "patient.stop": "Stop speaking",
      "patient.promptSub": "The clinician is listening",
      "patient.speakerDoctor": "Clinician",
      "patient.speakerPatient": "You",
      "patient.hint.ready": "READY · Waiting",
      "patient.hint.recording": "The clinician is speaking",
      "patient.hint.patient_speaking": "Speak now",
      "patient.hint.processing": "Translating and preparing audio",
      "patient.hint.processing_patient": "Sending this to the clinician…",
      "patient.roomConnected": "Connected to the room",
      "patient.roomConnectedBtn": "Connected",
      "patient.connectFailed": "Could not connect. Tap again.",
      "patient.needAudio": "Connect the speaker and microphone",
      "patient.connectingAudio": "Connecting speaker and microphone…",
      "patient.serverNeedAudio": "Server connected. Connect the speaker and microphone.",
      "patient.retrySoon": "Could not connect. Retrying in a second.",
      "patient.reconnecting": "Connection dropped. Reconnecting…",
      "patient.micDenied": "Microphone access was blocked.",
      "patient.pressUnlockFirst": "Press the speaker button first.",
      "patient.processing": "Working…",
      "patient.noWebAudio": "This device cannot play the audio.",
      "patient.badWs": "The server sent something this screen could not read.",

      "status.connecting": "Connecting…",
      "status.connected": "Connected",
      "status.failed": "Could not connect",
      "status.reconnecting": "Connection lost. Reconnecting…",
      "status.offline": "Not connected to the server.",
      "status.working": "Working…",
      "status.sending": "Sending…",
      "status.mic": "Allow the microphone to continue.",
      "status.sendFailed": "Could not send that.",
      "status.noAudio": "No audio was recorded.",
      "reset.idle": "End visit and clear the screen",
      "reset.nudge": "End visit and clear the screen for the next patient",
      "reset.aria": "End visit and clear the screen",
      "reset.ariaNudge": "End visit and clear the screen for the next patient",
      "common.processing": "Working…",
      "common.patientRecording": "Patient tablet is recording",
      "common.translating": "Translating",
    },
    ko: {
      "portfolio.title": "MediBridge",
      "portfolio.brand": "한국 진료실용",
      "portfolio.kicker": "",
      "portfolio.hero": "한국 진료실에서 쓰는 두 개의 화면.",
      "portfolio.lead": "환자가 한국어를 못 할 때는 통역 화면을 쓰고, 한국어 진료 뒤에는 서기 화면이 차트를 남깁니다. 의사가 설명한 주의사항은 요약 맨 위에 둡니다. 진료 화면이 한국어인 이유는 실제로 한국 병원에 배포하려고 만든 인터페이스이기 때문입니다. 이 안내만 영어로 두어 세 링크가 무엇인지 구분하게 했습니다. 화면 구성은 아직 동작하는 데모입니다.",
      "portfolio.how": "써 보는 순서",
      "portfolio.step1.title": "의사 화면과 환자 화면을 나란히 엽니다.",
      "portfolio.step1.body": "<a href=\"/doctor\">외국인 통역</a>은 이 창에 두고, <a href=\"/patient\">환자 태블릿</a>은 옆 창이나 태블릿에서 엽니다.",
      "portfolio.step2.title": "의사 말하기를 누르고 한국어로 말합니다.",
      "portfolio.step2.body": "환자 화면에 번역문이 뜨고, 문장 단위로 음성이 나갑니다. 언어는 의사 화면에서 고를 수 있습니다.",
      "portfolio.step3.title": "서기 화면에서 요약을 만듭니다.",
      "portfolio.step3.body": "<a href=\"/scribe\">AI 진료 서기</a>에서 대화를 녹음한 뒤 「진료 요약 생성」을 누릅니다. 의사가 설명한 부작용, 금기, 지시가 요약 맨 위에 붉게 남습니다.",
      "portfolio.screens": "세 화면",
      "portfolio.card1.role": "의사 · 외국인 환자",
      "portfolio.card1.title": "외국인 통역",
      "portfolio.card1.body": "한국어 대화와 외국어 번역이 화면 전체를 차지합니다. 위 탭으로 서기 모드와 전환됩니다.",
      "portfolio.card1.link": "통역 화면 열기",
      "portfolio.card2.role": "환자 태블릿",
      "portfolio.card2.title": "환자 화면",
      "portfolio.card2.body": "환자에게 보여줄 번역과 음성만 있습니다. 의사 화면의 조작 버튼은 여기 나오지 않습니다.",
      "portfolio.card2.link": "환자 화면 열기",
      "portfolio.card3.role": "의사 · 한국어 진료",
      "portfolio.card3.title": "AI 진료 서기",
      "portfolio.card3.body": "실시간 기록은 좁게, 진료 브리핑은 넓게 둡니다. 고지와 지시는 법적 방어 기록으로 맨 위에 강조됩니다.",
      "portfolio.card3.link": "서기 화면 열기",
      "portfolio.note": "각 화면에서 브라우저 뒤로 가기를 누르면 이 안내로 돌아옵니다. 다음 환자를 보기 전에는 화면 하단의 「진료 종료 및 화면 초기화」를 누릅니다.",

      "nav.aria": "의사 모드 선택",
      "nav.interpreter": "외국인 통역",
      "nav.scribe": "AI 진료 서기",
      "doctor.title": "MediBridge · 의사 (마스터)",
      "doctor.brand": "외국인 통역 · 진료실 통제",
      "doctor.settings": "단축키 설정",
      "doctor.langLabel": "수동 언어 설정",
      "doctor.langHint": "선택 즉시 환자 언어가 고정됩니다 (자동 감지 전에도 사용 가능)",
      "doctor.langPlaceholder": "언어를 선택하세요",
      "doctor.langAria": "수동 언어 설정",
      "doctor.stageAria": "실시간 통역 스크립트",
      "doctor.panelDoctorAria": "의사 한국어",
      "doctor.panelDoctor": "한국어 · 의사",
      "doctor.panelDoctorSub": "진료실 대화의 한국어 기록",
      "doctor.placeholder": "번역된 내용이 여기에 표시됩니다",
      "doctor.panelPatientAria": "환자 외국어 미리보기",
      "doctor.panelPatient": "외국어 · 환자",
      "doctor.detectedLabel": "현재 감지된 언어:",
      "doctor.panelPatientSub": "환자 태블릿에 표시될 번역문",
      "doctor.patientPlaceholder": "환자 화면에 표시될 번역문",
      "doctor.speak": "의사 말하기",
      "doctor.patientSpeak": "환자 말하기",
      "doctor.stop": "말하기 종료",
      "doctor.recording": "녹음 중...",
      "doctor.patientTitleWait": "환자 (자동 감지 대기)",
      "doctor.patientSubWait": "환자 모니터: 다국어 대기 화면",
      "doctor.patientTitleLocked": "환자 ({lang})",
      "doctor.manualLock": "수동 고정",
      "doctor.detectedLock": "음성 감지",
      "doctor.auto": "자동 감지",
      "doctor.patientSpeaking": "환자가 직접 말하는 중…",
      "doctor.settingsTitle": "마이크 단축키 설정",
      "doctor.settingsDesc": "입력칸을 클릭한 뒤 원하는 키를 누르세요.",
      "doctor.shortcutDoctor": "의사 말하기 단축키",
      "doctor.shortcutPatient": "환자 말하기 단축키",
      "doctor.save": "저장",
      "doctor.close": "닫기",
      "doctor.mic": "마이크를 연결하고 권한을 허용해 주세요",
      "doctor.resetConfirm": "현재 진료 기록을 초기화하시겠습니까?",
      "doctor.micBlocked": "마이크를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.",
      "doctor.sendFailed": "전송에 실패했습니다.",
      "doctor.processError": "처리 중 오류가 발생했습니다.",

      "scribe.title": "MediBridge · AI 진료 서기",
      "scribe.brand": "AI 진료 서기 · 방어 진료 차트",
      "scribe.banner": "좌측에서 대화를 녹음하고, 우측 브리핑에서 차트를 확인하세요. 고지사항은 요약 맨 위에 표시됩니다. 다음 환자 전에는 화면 아래의 진료 종료를 누르세요.",
      "scribe.scriptAria": "실시간 진료 스크립트",
      "scribe.doctorAria": "의사 발화",
      "scribe.doctor": "의사",
      "scribe.doctorSub": "한국어 STT",
      "scribe.doctorEmpty": "의사 발화가 여기에 표시됩니다",
      "scribe.patientAria": "환자 발화",
      "scribe.patient": "환자",
      "scribe.patientSub": "한국어 STT",
      "scribe.patientEmpty": "환자 발화가 여기에 표시됩니다",
      "scribe.briefingAria": "AI 진료 브리핑 및 방어 기록",
      "scribe.briefingTitle": "AI 진료 브리핑 및 방어 기록",
      "scribe.copy": "복사",
      "scribe.copyAria": "요약 복사",
      "scribe.placeholder": "진료 대화를 녹음한 뒤 진료 요약을 누르면\n의사 지시 및 고지사항이 맨 위에 표시됩니다.",
      "scribe.writing": "AI가 진료 요약을 작성하고 있습니다…",
      "scribe.emptyLog": "녹음된 대화가 없습니다. 의사/환자 말하기로 대화를 쌓아 주세요.",
      "scribe.whoDoctor": "의사",
      "scribe.whoPatient": "환자",
      "scribe.summary": "진료 요약 생성",
      "scribe.summaryLoading": "요약 생성 중…",
      "scribe.summaryAria": "진료 요약 생성",
      "scribe.noConversation": "요약할 대화가 없습니다. 먼저 진료 대화를 녹음해 주세요.",
      "scribe.noCopy": "복사할 요약이 없습니다.",
      "scribe.copied": "차트 요약본이 클립보드에 복사되었습니다. (Ctrl+V)",
      "scribe.copyFailed": "복사 실패",
      "scribe.emptySummary": "요약 결과가 비어 있습니다.",
      "scribe.genericError": "오류가 발생했습니다.",
      "scribe.micError": "마이크 오류",

      "patient.title": "MediBridge · 환자 (디스플레이)",
      "patient.brand": "환자 디스플레이 · 읽기 전용",
      "patient.screenAria": "환자 번역 화면",
      "patient.speakNow": "지금 말씀하세요",
      "patient.listening": "Listening...",
      "patient.translating": "번역 중",
      "patient.oneMoment": "잠시만 기다려 주세요",
      "patient.unlockTitle": "MediBridge 환자 모니터",
      "patient.unlockDesc": "출근 후 한 번만 눌러 주세요. 스피커·마이크 권한이 함께 활성화되며, 이후 번역 음성이 자동 재생됩니다.",
      "patient.unlock": "진료실 스피커·마이크 연결하기",
      "patient.welcome": "편하신 언어로 증상을 말씀해 주세요",
      "patient.detectedLabel": "현재 감지된 언어:",
      "patient.subtitleAria": "번역 자막",
      "patient.placeholder": "번역된 내용이 여기에 표시됩니다",
      "patient.start": "말하기 시작",
      "patient.stop": "말하기 종료",
      "patient.promptSub": "의사 선생님이 듣고 있습니다",
      "patient.speakerDoctor": "의사 선생님",
      "patient.speakerPatient": "환자님",
      "patient.hint.ready": "READY · 대기",
      "patient.hint.recording": "DOCTOR · 의사가 말씀하시는 중",
      "patient.hint.patient_speaking": "지금 말씀하세요 (Listening...)",
      "patient.hint.processing": "번역 및 음성 생성 중",
      "patient.hint.processing_patient": "의사 선생님에게 번역 중입니다...",
      "patient.roomConnected": "진료실 연결 완료",
      "patient.roomConnectedBtn": "✓ 진료실 연결 완료",
      "patient.connectFailed": "연결 실패 — 버튼을 다시 눌러 주세요",
      "patient.needAudio": "스피커·마이크 연결 필요",
      "patient.connectingAudio": "스피커·마이크 연결 중…",
      "patient.serverNeedAudio": "서버 연결됨 · 스피커·마이크 연결 필요",
      "patient.retrySoon": "연결 실패 · 1초 후 재시도",
      "patient.reconnecting": "연결 끊김 · 1초 후 재연결…",
      "patient.micDenied": "마이크 권한이 거부되었습니다",
      "patient.pressUnlockFirst": "스피커 연결 버튼을 먼저 눌러 주세요",
      "patient.processing": "처리 중…",
      "patient.noWebAudio": "이 기기는 번역 음성을 재생할 수 없습니다.",
      "patient.badWs": "서버에서 이 화면이 읽지 못하는 데이터가 왔습니다.",

      "status.connecting": "서버 연결 중…",
      "status.connected": "서버 연결됨",
      "status.failed": "서버 연결 실패",
      "status.reconnecting": "서버 연결 끊김 · 재연결 중…",
      "status.offline": "서버와 연결되어 있지 않습니다.",
      "status.working": "처리 중…",
      "status.sending": "전송 대기…",
      "status.mic": "마이크를 연결하고 권한을 허용해 주세요",
      "status.sendFailed": "전송 실패",
      "status.noAudio": "녹음된 오디오가 없습니다.",
      "reset.idle": "진료 종료 및 화면 초기화",
      "reset.nudge": "진료 종료 및 화면 초기화 (다음 환자 받기)",
      "reset.aria": "진료 종료 및 화면 초기화",
      "reset.ariaNudge": "진료 종료 및 초기화 — 다음 환자 받기",
      "common.processing": "처리 중",
      "common.patientRecording": "환자 태블릿 녹음 중",
      "common.translating": "번역 중",
    },
  };

  function t(key) {
    var table = STR[lang] || STR.en;
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    if (Object.prototype.hasOwnProperty.call(STR.en, key)) return STR.en[key];
    return key;
  }

  var listeners = [];

  function applyAttrs() {
    document.documentElement.lang = lang === "ko" ? "ko" : "en";
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    var htmlNodes = document.querySelectorAll("[data-i18n-html]");
    for (var j = 0; j < htmlNodes.length; j++) {
      htmlNodes[j].innerHTML = t(htmlNodes[j].getAttribute("data-i18n-html"));
    }
    var attrNodes = document.querySelectorAll("[data-i18n-attr]");
    for (var k = 0; k < attrNodes.length; k++) {
      var spec = attrNodes[k].getAttribute("data-i18n-attr") || "";
      spec.split("|").forEach(function (pair) {
        var idx = pair.indexOf(":");
        if (idx < 1) return;
        attrNodes[k].setAttribute(pair.slice(0, idx), t(pair.slice(idx + 1)));
      });
    }
    var titleEl = document.querySelector("title[data-i18n]");
    if (titleEl) document.title = titleEl.textContent;
    var sw = document.getElementById("mb-lang-switch");
    if (sw) {
      var buttons = sw.querySelectorAll("button");
      for (var b = 0; b < buttons.length; b++) {
        var active = buttons[b].getAttribute("data-set-lang") === lang;
        buttons[b].classList.toggle("is-active", active);
        buttons[b].setAttribute("aria-pressed", active ? "true" : "false");
      }
    }
  }

  function apply() {
    applyAttrs();
    listeners.forEach(function (fn) {
      try {
        fn(lang);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function setLang(next) {
    if (next !== "en" && next !== "ko") return;
    lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {}
    apply();
  }

  function mount() {
    if (document.getElementById("mb-lang-switch")) return;
    var header = document.querySelector("header.header");
    if (!header) return;
    var actions = header.querySelector(".header__actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "header__actions";
      var status = header.querySelector("#connection-status");
      if (status) actions.appendChild(status);
      header.appendChild(actions);
    }
    var wrap = document.createElement("div");
    wrap.id = "mb-lang-switch";
    wrap.className = "lang-switch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Language");
    [
      ["en", "EN"],
      ["ko", "한국어"],
    ].forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-set-lang", item[0]);
      btn.textContent = item[1];
      btn.addEventListener("click", function () {
        setLang(item[0]);
      });
      wrap.appendChild(btn);
    });
    actions.insertBefore(wrap, actions.firstChild);
  }

  function boot() {
    mount();
    apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.MbLang = {
    t: t,
    get: function () {
      return lang;
    },
    set: setLang,
    onChange: function (fn) {
      listeners.push(fn);
    },
    apply: apply,
  };
})();
