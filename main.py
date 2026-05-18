import asyncio
import base64
import json
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger("medibridge")
logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI

app = FastAPI(title="MediBridge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

LANG_LABEL_KO: dict[str, str] = {
    "en": "영어",
    "vi": "베트남어",
    "zh": "중국어",
    "ja": "일본어",
    "th": "태국어",
    "uz": "우즈베크어",
    "id": "인도네시아어",
    "km": "캄보디아어",
    "ne": "네팔어",
    "tl": "타갈로그어",
    "ru": "러시아어",
    "ko": "한국어",
}

LANG_NAMES: dict[str, str] = {
    "en": "English",
    "vi": "Vietnamese",
    "zh": "Chinese",
    "ja": "Japanese",
    "th": "Thai",
    "uz": "Uzbek",
    "id": "Indonesian",
    "km": "Khmer",
    "ne": "Nepali",
    "tl": "Tagalog",
    "ru": "Russian",
    "ko": "Korean",
}

APP_LANG_CODES: frozenset[str] = frozenset(LANG_LABEL_KO.keys())

# OpenAI Whisper (whisper-1) supported ISO 639-1 codes
WHISPER_SUPPORTED_LANGS: frozenset[str] = frozenset(
    {
        "af", "ar", "hy", "as", "az", "be", "bn", "bs", "bg", "ca", "cs", "cy",
        "da", "de", "el", "en", "es", "et", "fa", "fi", "fr", "gl", "gu", "ha",
        "he", "hi", "hr", "hu", "id", "is", "it", "ja", "jw", "ka", "kk", "km",
        "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml",
        "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl",
        "ps", "pt", "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq",
        "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt",
        "uk", "ur", "uz", "vi", "yi", "yo", "zh",
    }
)

LANG_CODE_ALIASES: dict[str, str] = {
    "english": "en",
    "vietnamese": "vi",
    "chinese": "zh",
    "mandarin": "zh",
    "cantonese": "zh",
    "japanese": "ja",
    "thai": "th",
    "uzbek": "uz",
    "indonesian": "id",
    "khmer": "km",
    "nepali": "ne",
    "tagalog": "tl",
    "filipino": "tl",
    "russian": "ru",
    "korean": "ko",
    "auto": "",
    "unknown": "",
    "jp": "ja",
    "jpn": "ja",
    "cn": "zh",
    "chs": "zh",
    "cht": "zh",
    "burmese": "my",
    "myanmar": "my",
    # Whisper verbose_json may return full names; never truncate to unsupported "ny"
    "ny": "",
    "nyanja": "",
    "chichewa": "",
}


class ConnectionManager:
    """연결된 모든 클라이언트(의사·환자 화면)에 브로드캐스트."""

    def __init__(self) -> None:
        self.connections: dict[WebSocket, str] = {}

    def register(self, websocket: WebSocket, role: str) -> None:
        self.connections[websocket] = role

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.pop(websocket, None)

    def get_role(self, websocket: WebSocket) -> str:
        return self.connections.get(websocket, "display")

    async def broadcast(self, message: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.connections.keys()):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to_displays(self, message: dict) -> None:
        """환자 디스플레이(display) 연결에만 전송."""
        dead: list[WebSocket] = []
        for ws, role in list(self.connections.items()):
            if role != "display":
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()

# 진료 세션에 고정된 환자 타겟 언어 (환자 발화 시 Whisper 감지로 Lock-in)
current_session_lang: str | None = None

# 환자 태블릿에서 원격 녹음된 오디오 청크
patient_remote_chunks: list[bytes] = []

DEFAULT_DOCTOR_TARGET_LANG = "en"

TTS_VOICE_DEFAULT = "nova"
TTS_VOICE_ALT = "onyx"

MEDICAL_INTERPRETER_SYSTEM_PROMPT = """You are an expert medical interpreter working in a Korean hospital outpatient clinic.
Your role is to produce accurate, patient-safe clinical translations between Korean and foreign languages.

## Core rules
1. Preserve clinical meaning, urgency, anatomy, symptoms, duration, severity, and negation exactly.
2. Use plain, patient-friendly local medical phrasing in the target language (not literal word-for-word translation).
3. Output ONLY the final translated text — no quotes, labels, explanations, or markdown.
4. Never invent symptoms, diagnoses, or medications not present in the source.

## Gyeongsang dialect & colloquial Korean normalization (when source is Korean)
Before translating, mentally normalize regional/colloquial Korean into standard clinical Korean meaning:
- "디이소/디였다" → "되었습니다" (past tense / completion in context)
- "할딱거린다" → "호흡 곤란" or "숨이 가쁩니다" (dyspnea)
- "우리하게 아프다" → "지속적인 둔한 통증이 있습니다"
- "새하다" → "시리고 알싸한 통증이 있습니다"
- "에린다" → "쑤시고 아픕니다"
- "-했심더", "-능교" and similar endings → infer standard past/polite clinical tense from context
- Other unclear dialect: choose the most likely standard medical Korean equivalent without adding new facts.

## Hospital custom medical dictionary (anti-mistranslation)
Apply these intent mappings consistently:
| Korean (normalized) | Clinical intent |
| 호흡 곤란, 숨 가쁨, 할딱거림 | dyspnea / shortness of breath |
| 시림, 새하다 | sharp/tingling pain |
| 둔한 통증, 우리하게 아픔 | dull aching pain |
| 쑤심, 에림 | throbbing / stabbing pain |
| 어지럼 | dizziness |
| 메스꺼움, 토함 | nausea / vomiting |
| 설사 | diarrhea |
| 변비 | constipation |
| 발열 | fever |
| 부종 | swelling / edema |
| 가래 | sputum / phlegm |
| 기침 | cough |
| 흉통 | chest pain |
| 복통 | abdominal pain |

## Target-language quality
- For patient-facing output: use natural, respectful, easy-to-understand clinical phrasing native to the target locale.
- Avoid idioms, slang, and ambiguous abbreviations.
- Keep sentences concise for bedside communication."""


def reset_session_language() -> None:
    """진료 종료(초기화) 시 세션 언어 잠금 해제."""
    global current_session_lang
    current_session_lang = None


def lock_session_language(lang_code: str) -> str:
    """환자 음성에서 감지된 언어로 세션 타겟 언어 고정."""
    global current_session_lang
    resolved = resolve_app_lang_code(lang_code, default="")
    if not resolved:
        resolved = DEFAULT_DOCTOR_TARGET_LANG
    current_session_lang = resolved
    return current_session_lang


def resolve_app_lang_code(code: str | None, *, default: str = "en") -> str:
    """앱·번역·세션용 ISO 639-1 (지원 목록만 허용, 임의 2글자 절단 금지)."""
    if not code:
        return default
    lowered = str(code).lower().strip().replace("_", "-")
    if lowered in ("", "auto", "unknown"):
        return default
    if lowered in APP_LANG_CODES:
        return lowered
    alias = LANG_CODE_ALIASES.get(lowered)
    if alias:
        return alias if alias in APP_LANG_CODES else default
    if len(lowered) == 2 and lowered in APP_LANG_CODES:
        return lowered
    if len(lowered) >= 3:
        prefix = lowered[:2]
        if prefix in APP_LANG_CODES:
            return prefix
    logger.warning("Unsupported app language code %r → default %r", code, default)
    return default


def whisper_language_param(code: str | None) -> str | None:
    """Whisper API language 인자. 불확실·미지원이면 None(자동 감지)."""
    if not code:
        return None
    lowered = str(code).lower().strip()
    if lowered in ("", "auto", "unknown"):
        return None
    resolved = resolve_app_lang_code(code, default="")
    if not resolved:
        return None
    if resolved in WHISPER_SUPPORTED_LANGS:
        return resolved
    logger.warning(
        "Language %r not supported by Whisper; omitting language parameter",
        code,
    )
    return None


def normalize_lang_code(code: str | None) -> str:
    return resolve_app_lang_code(code, default="en")


def label_ko_for_code(code: str) -> str:
    return LANG_LABEL_KO.get(normalize_lang_code(code), code)


def session_state_payload() -> dict:
    locked = current_session_lang is not None
    return {
        "type": "session_update",
        "session_lang": current_session_lang,
        "language_locked": locked,
        "detected_language_label_ko": (
            label_ko_for_code(current_session_lang) if locked else "자동 감지"
        ),
    }


WHISPER_UPLOAD_MIME: dict[str, str] = {
    ".webm": "audio/webm",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".mpeg": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


def whisper_upload_file(file_path: str) -> tuple[str, object, str]:
    """OpenAI Whisper file= 튜플 (파일명, 바이너리 스트림, MIME) — Invalid file format 방지."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in WHISPER_UPLOAD_MIME:
        ext = ".webm"
    upload_name = f"recording{ext}"
    upload_mime = WHISPER_UPLOAD_MIME[ext]
    audio_file = open(file_path, "rb")
    return upload_name, audio_file, upload_mime


def transcribe_audio(
    file_path: str,
    language_hint: str | None = None,
    *,
    auto_detect_only: bool = False,
) -> tuple[str, str]:
    kwargs: dict = {
        "model": "whisper-1",
        "response_format": "verbose_json",
    }
    whisper_lang = None if auto_detect_only else whisper_language_param(language_hint)
    if whisper_lang:
        kwargs["language"] = whisper_lang
        logger.info("Whisper transcribe with language=%s (hint=%r)", whisper_lang, language_hint)
    else:
        logger.info(
            "Whisper transcribe with auto language detection (hint=%r, auto_detect_only=%s)",
            language_hint,
            auto_detect_only,
        )

    upload_name, audio_file, upload_mime = whisper_upload_file(file_path)
    try:
        logger.info(
            "Whisper upload file=%s mime=%s size=%s bytes",
            upload_name,
            upload_mime,
            os.path.getsize(file_path),
        )
        transcript = client.audio.transcriptions.create(
            file=(upload_name, audio_file, upload_mime),
            **kwargs,
        )
    finally:
        audio_file.close()

    text = (transcript.text or "").strip()
    raw_detected = getattr(transcript, "language", None)
    detected = resolve_app_lang_code(raw_detected, default="")
    if not detected and language_hint:
        detected = resolve_app_lang_code(language_hint, default=DEFAULT_DOCTOR_TARGET_LANG)
    if not detected:
        detected = DEFAULT_DOCTOR_TARGET_LANG
    return text, detected


def resolve_patient_target_lang(override: str | None = None) -> str:
    """환자 모니터 표시·의사→환자 번역 타깃 언어 (의사 수동 선택 > 세션 고정 > 기본 영어)."""
    if override:
        lowered = str(override).lower().strip()
        if lowered not in ("", "auto", "unknown"):
            resolved = resolve_app_lang_code(override, default="")
            if resolved:
                return resolved
    if current_session_lang:
        return current_session_lang
    return DEFAULT_DOCTOR_TARGET_LANG


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    source = LANG_NAMES.get(normalize_lang_code(source_lang), source_lang)
    target = LANG_NAMES.get(normalize_lang_code(target_lang), target_lang)
    source_code = normalize_lang_code(source_lang)
    target_code = normalize_lang_code(target_lang)

    if source_code == "ko":
        user_content = (
            f"Translate the following medical text into {target} ({target_code}).\n\n"
            "Follow this two-step pipeline strictly:\n"
            "STEP 1 — Dialect & colloquial normalization (Korean → standard clinical Korean):\n"
            '  • "디이소/디였다" → 되었습니다 (contextual past/completion)\n'
            '  • "할딱거린다" → 호흡 곤란 / 숨이 가쁩니다\n'
            '  • "우리하게 아프다" → 지속적인 둔한 통증이 있습니다\n'
            '  • "새하다" → 시리고 알싸한 통증이 있습니다\n'
            '  • "에린다" → 쑤시고 아픕니다\n'
            "  • -했심더 / -능교 → infer standard polite clinical tense\n"
            "  • Apply the hospital medical dictionary mappings from the system prompt.\n"
            "STEP 2 — Translate the normalized Korean into the target language only.\n"
            "Output ONLY the final translation.\n\n"
            f"Medical text (Korean, may contain dialect):\n{text}"
        )
    else:
        user_content = (
            f"Translate the following medical text into {target} ({target_code}).\n"
            "Use plain, patient-friendly clinical phrasing.\n"
            "Output ONLY the translation — no labels or explanations.\n\n"
            f"Medical text ({source}):\n{text}"
        )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": MEDICAL_INTERPRETER_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.2,
    )
    return (response.choices[0].message.content or "").strip()


def pick_tts_voice(lang_code: str) -> str:
    """언어별 TTS 보이스 선택 (nova 기본, 일부 언어 onyx)."""
    code = normalize_lang_code(lang_code)
    if code in ("ru", "ne", "uz"):
        return TTS_VOICE_ALT
    return TTS_VOICE_DEFAULT


def synthesize_patient_tts(
    text: str,
    lang_code: str,
    *,
    voice: str | None = None,
) -> str | None:
    """환자 화면용 번역문 TTS → Base64 MP3."""
    cleaned = (text or "").strip()
    if not cleaned:
        return None

    voice = voice or pick_tts_voice(lang_code)
    response = client.audio.speech.create(
        model="tts-1",
        voice=voice,
        input=cleaned,
        response_format="mp3",
    )
    audio_bytes = response.read()
    if not audio_bytes:
        return None
    return base64.b64encode(audio_bytes).decode("ascii")


def build_ui_payload(result: dict) -> dict:
    """양쪽 화면에 표시할 텍스트 필드를 포함한 브로드캐스트 페이로드."""
    speaker = result.get("speaker")
    original = result.get("original", "")
    translated = result.get("translated", "")

    if speaker == "doctor":
        doctor_text = original
        patient_text = translated
    else:
        doctor_text = translated
        patient_text = original

    return {
        **result,
        "doctor_text": doctor_text,
        "patient_text": patient_text,
    }


async def process_audio_session(
    audio_bytes: bytes,
    speaker: str,
    *,
    target_lang: str | None = None,
) -> dict:
    global current_session_lang

    if not audio_bytes:
        raise ValueError("수신된 오디오 데이터가 없습니다.")

    if not os.environ.get("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".webm", prefix="medibridge_", delete=False
        ) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            tmp_path = tmp.name

        if speaker == "doctor":
            # 의사 발화: Whisper 자동 언어 감지 (language 파라미터 미사용)
            original, detected_source = await asyncio.to_thread(
                transcribe_audio, tmp_path, None, auto_detect_only=True
            )
        else:
            language_hint = current_session_lang if current_session_lang else None
            original, detected_source = await asyncio.to_thread(
                transcribe_audio, tmp_path, language_hint
            )

        if not original:
            raise ValueError("음성에서 텍스트를 인식하지 못했습니다.")

        if speaker == "doctor":
            dest_lang = resolve_patient_target_lang(target_lang)
            logger.info(
                "Doctor speech: whisper_source=%s → translate target=%s (override=%r)",
                detected_source,
                dest_lang,
                target_lang,
            )
            translated = await asyncio.to_thread(
                translate_text, original, detected_source, dest_lang
            )
            payload = build_ui_payload(
                {
                    "type": "result",
                    "speaker": "doctor",
                    "original": original,
                    "translated": translated,
                    "detected_language": dest_lang,
                    "detected_language_label_ko": label_ko_for_code(dest_lang),
                    "source_language": detected_source,
                    "session_lang": dest_lang,
                    "language_locked": current_session_lang is not None,
                }
            )
            patient_line = payload.get("patient_text", "")
            tts_b64 = await asyncio.to_thread(
                synthesize_patient_tts,
                patient_line,
                dest_lang,
                voice=TTS_VOICE_DEFAULT,
            )
            if tts_b64:
                # WebSocket JSON: MP3 bytes as ASCII Base64 (not URL, not raw binary frame)
                payload["tts_format"] = "base64"
                payload["tts_audio_b64"] = tts_b64
                payload["tts_mime"] = "audio/mpeg"
            return payload

        # 환자 발화: Whisper 감지 언어로 세션 Lock-in → 한국어 번역
        locked_lang = lock_session_language(detected_source)
        translated = await asyncio.to_thread(
            translate_text, original, locked_lang, "ko"
        )
        return build_ui_payload(
            {
                "type": "result",
                "speaker": "patient",
                "original": original,
                "translated": translated,
                "detected_language": locked_lang,
                "detected_language_label_ko": label_ko_for_code(locked_lang),
                "source_language": locked_lang,
                "session_lang": locked_lang,
                "language_locked": True,
            }
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.get("/")
async def root():
    return RedirectResponse(url="/doctor")


@app.get("/doctor")
async def serve_doctor():
    path = BASE_DIR / "doctor.html"
    if path.exists():
        return FileResponse(path)
    return {"error": "doctor.html not found"}


@app.get("/patient")
async def serve_patient():
    path = BASE_DIR / "patient.html"
    if path.exists():
        return FileResponse(path)
    return {"error": "patient.html not found"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "openai_configured": bool(os.environ.get("OPENAI_API_KEY")),
        "connections": len(manager.connections),
        "session_lang": current_session_lang,
        "language_locked": current_session_lang is not None,
    }


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.websocket("/ws/audio")
async def websocket_audio(websocket: WebSocket):
    """모든 Origin·외부 IP에서 WebSocket 업그레이드를 허용 (Origin 검사 없음)."""
    client = websocket.client
    client_addr = f"{client.host}:{client.port}" if client else "unknown"
    origin = websocket.headers.get("origin", "(없음)")
    logger.info(
        "WebSocket 연결 시도 → accept | client=%s origin=%s path=/ws/audio",
        client_addr,
        origin,
    )
    await websocket.accept()
    manager.register(websocket, "display")
    logger.info("WebSocket 연결됨 | role=display client=%s", client_addr)

    chunks: list[bytes] = []
    session_meta: dict = {}

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")
            action = msg.get("action")

            if action == "start_patient_record":
                if manager.get_role(websocket) != "doctor":
                    continue
                patient_remote_chunks.clear()
                await manager.send_to_displays(
                    {"type": "remote_patient_record", "phase": "start"}
                )
                continue

            if action == "stop_patient_record":
                if manager.get_role(websocket) != "doctor":
                    continue
                logger.info("stop_patient_record → display stop + broadcast translating")
                await manager.send_to_displays(
                    {"type": "remote_patient_record", "phase": "stop"}
                )
                await manager.broadcast({"status": "translating", "speaker": "patient"})
                continue

            if msg_type == "patient_audio":
                if manager.get_role(websocket) != "display":
                    continue
                phase = msg.get("phase")
                if phase == "chunk":
                    data_b64 = msg.get("data", "")
                    if data_b64:
                        patient_remote_chunks.append(base64.b64decode(data_b64))
                elif phase == "end":
                    try:
                        result = await process_audio_session(
                            audio_bytes=b"".join(patient_remote_chunks),
                            speaker="patient",
                        )
                        await manager.broadcast(result)
                    except Exception as exc:
                        await manager.broadcast(
                            {
                                "type": "error",
                                "message": str(exc),
                                "speaker": "patient",
                            }
                        )
                    patient_remote_chunks.clear()
                continue

            if msg_type == "register":
                manager.register(websocket, msg.get("role", "display"))
                await websocket.send_json(
                    {"type": "registered", "role": manager.get_role(websocket)}
                )
                await websocket.send_json(session_state_payload())
                continue

            if msg_type == "set_language":
                if manager.get_role(websocket) != "doctor":
                    continue
                lang_code = msg.get("lang_code")
                if not lang_code or str(lang_code).lower().strip() in ("auto", ""):
                    continue
                locked = lock_session_language(lang_code)
                payload = session_state_payload()
                payload["manual"] = True
                payload["detected_language_label_ko"] = label_ko_for_code(locked)
                await manager.broadcast(payload)
                continue

            if msg_type == "reset":
                if manager.get_role(websocket) == "doctor":
                    reset_session_language()
                    await manager.broadcast(
                        {
                            "type": "reset",
                            "session_lang": None,
                            "language_locked": False,
                            "detected_language_label_ko": "자동 감지",
                            "stop_audio": True,
                        }
                    )
                continue

            if msg_type == "start":
                if manager.get_role(websocket) != "doctor":
                    continue
                speaker = msg.get("speaker", "doctor")
                if speaker != "doctor":
                    continue
                chunks = []
                session_meta = {
                    "speaker": "doctor",
                    "target_lang": msg.get("target_lang", "auto"),
                    "manual_lang": msg.get("manual_lang"),
                }

            elif msg_type == "chunk":
                if manager.get_role(websocket) != "doctor":
                    continue
                data_b64 = msg.get("data", "")
                if data_b64:
                    chunks.append(base64.b64decode(data_b64))

            elif msg_type == "end":
                if manager.get_role(websocket) != "doctor":
                    continue
                speaker = session_meta.get("speaker", "doctor")
                target_override = session_meta.get("manual_lang") or session_meta.get(
                    "target_lang"
                )
                await manager.broadcast(
                    {"type": "processing", "speaker": speaker}
                )
                try:
                    result = await process_audio_session(
                        audio_bytes=b"".join(chunks),
                        speaker=speaker,
                        target_lang=target_override,
                    )
                    await manager.broadcast(result)
                except Exception as exc:
                    await manager.broadcast(
                        {"type": "error", "message": str(exc), "speaker": speaker}
                    )
                chunks = []
                session_meta = {}

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("WebSocket 연결 종료 | client=%s", client_addr)
        manager.disconnect(websocket)
