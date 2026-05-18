import asyncio
import base64
import binascii
import json
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger("medibridge")
logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
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

PATIENT_UI_STATUSES = frozenset(
    {"recording", "processing", "ready", "patient_speaking"}
)

# 의사 → 서버 state_change → 환자 디스플레이 status
STATE_CHANGE_TO_DISPLAY: dict[str, tuple[str, str]] = {
    "patient_speaking": ("patient_speaking", "patient"),
    "doctor_speaking": ("recording", "doctor"),
    "recording": ("recording", "doctor"),
    "processing": ("processing", "doctor"),
    "ready": ("ready", "doctor"),
}


async def broadcast_patient_status(status: str, *, speaker: str = "doctor") -> None:
    """환자 디스플레이에만 UI 상태 패킷 전송."""
    if status not in PATIENT_UI_STATUSES:
        return
    payload = {"type": "status", "status": status, "speaker": speaker}
    logger.info("broadcast_patient_status → displays: %s", payload)
    await manager.send_to_displays(payload)


async def relay_doctor_state_change(msg: dict) -> None:
    """의사 state_change를 환자 디스플레이 status 패킷으로 변환·전송."""
    state = (msg.get("state") or "").strip()
    speaker_override = (msg.get("speaker") or "").strip()
    mapped = STATE_CHANGE_TO_DISPLAY.get(state)
    if not mapped:
        logger.warning("Unknown state_change state=%r", state)
        return
    status, default_speaker = mapped
    speaker = speaker_override if speaker_override in ("doctor", "patient") else default_speaker
    if state == "processing" and speaker_override == "patient":
        speaker = "patient"
    await broadcast_patient_status(status, speaker=speaker)


# 진료 세션에 고정된 환자 타겟 언어 (환자 발화 시 Whisper 감지로 Lock-in)
current_session_lang: str | None = None

# 환자 태블릿에서 원격 녹음된 오디오 청크
patient_remote_chunks: list[bytes] = []

DEFAULT_DOCTOR_TARGET_LANG = "en"

TTS_VOICE_DEFAULT = "nova"
TTS_VOICE_ALT = "onyx"

# 번역·문맥 교정용 채팅 모델 (지연 시간 최적화)
GPT_CHAT_MODEL = "gpt-4o-mini"

# Whisper: 범용 의원 진료실 (의사 발화 STT)
WHISPER_DOCTOR_PROMPT = (
    "이 음성은 한국의 일반 의원(내과, 정형외과, 이비인후과 등) 진료실에서 의사와 외국인 환자가 나누는 대화입니다. "
    "의사 선생님이 환자의 통증이나 다양한 질환 증상을 묻고 진찰하며, 약 처방 및 향후 주의사항을 정중하게 안내하는 상황입니다. "
    "경상도 사투리나 흘리는 발음, 일상적인 의학 용어가 있더라도 전체 맥락을 파악하여 표준어로 자연스럽고 정확하게 받아적어 주세요."
)

MEDICAL_INTERPRETER_SYSTEM_PROMPT = """You are an intelligent medical AI assistant in a Korean hospital outpatient clinic.
You specialize in interpreting a doctor's spoken Korean (via speech-to-text) into the patient's language with clinical accuracy and safety.

## Core rules
1. Preserve clinical meaning, urgency, anatomy, symptoms, duration, severity, and negation exactly.
2. Use plain, patient-friendly local medical phrasing in the target language (not literal word-for-word translation).
3. Output ONLY the final translated text — no quotes, labels, explanations, or markdown.
4. Never invent symptoms, diagnoses, or medications not present in the source after honest interpretation of what was said.

## Whisper STT repair — medical consultation mode (Korean doctor speech)
Speech-to-text (Whisper) often blurs pronunciation and writes phonetically similar but wrong everyday words instead of medical terms.
Your job is to fix these BEFORE translating, using whole-sentence clinical plausibility — not word-by-word literal rendering.

### When to enter "medical consultation mode"
Treat the full utterance as medical consultation mode if ANY of the following apply:
- The sentence discusses symptoms, pain, examination, tests, medication, injection, diagnosis, treatment, anatomy, or follow-up care.
- Clinical cue words appear (examples, not exhaustive): 배, 통증, 약, 증상, 진찰, 주사, 처방, 검사, 수술, 염증, 열, 기침, 호흡, 혈압, 부종, 골절, 위염, 장염, 메스꺼움, 어지럼, 처방, 복용, 입원, 퇴원.
- The overall flow reads like bedside or outpatient clinical communication rather than casual small talk.

### Medical context filter (의료 문맥 필터) — STT homophone repair
When the utterance is clearly about **symptoms, diagnosis, prescription, medication timing, or follow-up care**:
1. Read the ENTIRE sentence; treat Whisper output as possibly wrong on near-homophone words.
2. **Mandatory check:** If you see "작년" (last year) but surrounding context is clinical (e.g., diagnosis explanation, "입니다/예요", 배·장·염·증상·약·처방·식후·복용), correct to **"장염"** (enteritis) or the most fitting medical term — NOT calendar time.
3. Apply the same logic to all similar confusions (illustrative only):
   - 장염 ↔ 작년, 부종 ↔ 부정, 골절 ↔ 고절, 위염 ↔ 위험, 복통-related confusions, etc.
4. Use medical co-occurrence: body site, duration, severity, and typical presentation guide correction.
5. Do not over-correct when the sentence is genuinely about time or personal history (see below).
6. Never add clinical facts not supported by the corrected reading.

### In medical consultation mode — proactive homophone / near-homophone correction
1. Read the ENTIRE sentence and infer the doctor's most likely intended clinical meaning.
2. Where a word is medically implausible but sounds like a standard medical term, silently replace it with the contextually appropriate medical term before translating.
3. Gyeongsang dialect STT noise: normalize endings and particles (e.g., 했다이가→하였습니다, 맞나→맞습니까/드셨습니까 by context) while preserving meaning.

### When to KEEP everyday / non-clinical wording
Do NOT force medical terms when the doctor clearly speaks about non-clinical context:
- Time references: 작년, 어제, 지난달, 다음 주 — when the sentence is about personal history, travel, work, or scheduling.
- Daily life: family, job, habits, emotions unrelated to current symptom workup.
- Example: "작년에 해외여행 다녀오셨나요?" → keep 작년 as "last year", not enteritis (장염).
Judge by sentence-level intent and medical relevance, not isolated keyword triggers.

### Korean → foreign language pipeline (doctor → patient)
When translating Korean doctor speech outward, apply in order:
A. Decide medical consultation mode vs everyday narrative (per sections above).
B. STT homophone / near-homophone repair → standard clinical Korean (if mode is medical).
C. Dialect & colloquial normalization (section below).
D. Hospital medical dictionary mappings (section below).
E. Translate into the target language only.

## Gyeongsang (경남·경북) dialect & colloquial Korean normalization (when source is Korean)
Before translating, normalize 경상도 사투리 and colloquial clinic speech into standard clinical Korean:
- "디이소/디였다" → "되었습니다" (past tense / completion in context)
- "할딱거린다" → "호흡 곤란" or "숨이 가쁩니다" (dyspnea)
- "우리하게 아프다" → "지속적인 둔한 통증이 있습니다"
- "새하다" → "시리고 알싸한 통증이 있습니다"
- "에린다" → "쑤시고 아픕니다"
- "했다이가/했심더" → standard past polite clinical tense (e.g., 하였습니다, 되었습니다)
- "맞나" (medication context) → "맞습니까" / "드셨습니까" / "복용하셨습니까" by context
- "-했심더", "-능교", "-나요(사투리 억양)" → infer standard polite clinical tense from context
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

## Translation tone & manner (doctor → patient) — 정중하고 명확한 복약·주의 지도
You represent the doctor's professionalism and dignity as a courteous medical interpreter.
- Refine overly technical or textbook phrases into **polite, clear everyday medical language** the patient can follow at home for medication and self-care — without losing clinical accuracy.
  Example style: prefer wording like "stomach flu symptoms causing diarrhea" over lecturing "acute gastrointestinal inflammation with mucosal irritation" — in the patient's language, naturally.
- **Never** use childish or infantile tone (e.g., baby-talk pain descriptions, cutesy diminutives, playful mood).
- Use respectful honorific/register appropriate to professional bedside care in the target locale; keep sentences structurally clear for medication timing, precautions, and follow-up.
- This is NOT "dumbing down" the doctor: preserve seriousness, authority, and care — only remove unnecessary jargon barriers.

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


def decode_audio_chunk_b64(data_b64: str) -> bytes:
    """JSON 청크의 Base64 오디오만 추출 (메타데이터와 분리)."""
    if not isinstance(data_b64, str):
        raise ValueError("chunk data must be a base64 string")
    cleaned = data_b64.strip()
    if not cleaned:
        return b""
    try:
        return base64.b64decode(cleaned, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("invalid base64 audio chunk") from exc


def assemble_doctor_audio(chunks: list[bytes]) -> bytes:
    """의사 녹음 청크를 순수 바이트열로 병합."""
    return b"".join(chunks)


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
    whisper_prompt: str | None = None,
) -> tuple[str, str]:
    kwargs: dict = {
        "model": "whisper-1",
        "response_format": "verbose_json",
    }
    if whisper_prompt:
        kwargs["prompt"] = whisper_prompt
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
    if whisper_prompt:
        logger.info("Whisper context prompt applied (len=%d)", len(whisper_prompt))

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
    if not detected and not auto_detect_only:
        detected = DEFAULT_DOCTOR_TARGET_LANG
    return text, detected


def resolve_patient_target_lang() -> str:
    """의사→환자 TTS/번역 타깃: 환자 발화 자동 감지로 잠긴 세션 언어, 없으면 기본 영어."""
    if current_session_lang and current_session_lang != "ko":
        return current_session_lang
    return DEFAULT_DOCTOR_TARGET_LANG


def reconcile_patient_korean_false_positive(whisper_text: str) -> str:
    """Whisper가 환자 음성을 한국어로 오인한 경우 GPT로 소음 제거 또는 의역."""
    cleaned = (whisper_text or "").strip()
    if not cleaned:
        return ""
    user_content = (
        "A foreign patient's speech was incorrectly transcribed as Korean by the speech-to-text system.\n\n"
        f"False Korean transcript:\n{cleaned}\n\n"
        "Rules:\n"
        "1. If this is only noise, mumbling, breath sounds, or meaningless clinic background audio, "
        "output exactly an empty string (nothing else).\n"
        "2. If it likely was foreign speech (e.g. English, Vietnamese) misheard as Korean, "
        "infer the clinical meaning and output ONE clear, polite Korean sentence for the doctor.\n"
        "3. Output ONLY the final Korean text, or an empty string — no labels or explanations."
    )
    response = client.chat.completions.create(
        model=GPT_CHAT_MODEL,
        messages=[
            {"role": "system", "content": MEDICAL_INTERPRETER_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.2,
    )
    return (response.choices[0].message.content or "").strip()


def translate_text(
    text: str,
    source_lang: str,
    target_lang: str,
) -> str:
    source = LANG_NAMES.get(normalize_lang_code(source_lang), source_lang)
    target = LANG_NAMES.get(normalize_lang_code(target_lang), target_lang)
    source_code = normalize_lang_code(source_lang)
    target_code = normalize_lang_code(target_lang)

    if source_code == "ko":
        user_content = (
            f"Translate the following doctor utterance (Korean STT transcript) into {target} ({target_code}).\n\n"
            "Apply the system prompt [Translation tone & manner] strictly: polite, clear everyday medical language; "
            "no infantile tone; preserve the doctor's professional weight.\n\n"
            "Follow the system prompt pipeline strictly:\n"
            "STEP A — Medical consultation mode: judge the whole sentence; if clinical, proceed with STT repair.\n"
            "STEP B — Medical context filter: if symptoms/prescription context applies and STT wrote '작년', "
            "correct to '장염' (or fitting term); fix all similar homophones; keep real time references only "
            "when the sentence is clearly non-clinical (e.g. travel last year).\n"
            "STEP C — Dialect & colloquial normalization (Korean → standard clinical Korean):\n"
            '  • "디이소/디였다" → 되었습니다 (contextual past/completion)\n'
            '  • "할딱거린다" → 호흡 곤란 / 숨이 가쁩니다\n'
            '  • "우리하게 아프다" → 지속적인 둔한 통증이 있습니다\n'
            '  • "새하다" → 시리고 알싸한 통증이 있습니다\n'
            '  • "에린다" → 쑤시고 아픕니다\n'
            "  • -했심더 / -능교 → infer standard polite clinical tense\n"
            "STEP D — Apply the hospital medical dictionary from the system prompt.\n"
            "STEP E — Translate the corrected, normalized Korean into the target language only.\n"
            "Output ONLY the final translation.\n\n"
            f"Doctor speech transcript (Korean, may contain STT errors and dialect):\n{text}"
        )
    else:
        user_content = (
            f"Translate the following medical text into {target} ({target_code}).\n"
            "Use polite, clear clinical phrasing (not infantile or overly casual).\n"
            "Output ONLY the translation — no labels or explanations.\n\n"
            f"Medical text ({source}):\n{text}"
        )

    response = client.chat.completions.create(
        model=GPT_CHAT_MODEL,
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
    upload_filename: str | None = None,
) -> dict:
    global current_session_lang

    if not audio_bytes:
        raise ValueError("수신된 오디오 데이터가 없습니다.")

    if len(audio_bytes) < 64:
        raise ValueError("오디오 데이터가 너무 짧거나 손상되었습니다.")

    if not os.environ.get("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.")

    suffix = ".webm"
    if upload_filename:
        ext = os.path.splitext(upload_filename)[1].lower()
        if ext in WHISPER_UPLOAD_MIME:
            suffix = ext

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=suffix, prefix="medibridge_", delete=False
        ) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            tmp_path = tmp.name

        if speaker == "doctor":
            logger.info("Doctor Whisper prompt=universal clinic")
            original, detected_source = await asyncio.to_thread(
                transcribe_audio,
                tmp_path,
                None,
                auto_detect_only=True,
                whisper_prompt=WHISPER_DOCTOR_PROMPT,
            )
        else:
            original, detected_source = await asyncio.to_thread(
                transcribe_audio, tmp_path, None, auto_detect_only=True
            )
            detected_norm = normalize_lang_code(detected_source) if detected_source else ""
            logger.info(
                "Patient speech: Whisper auto-detect → language=%r text_len=%d",
                detected_norm or "(unknown)",
                len(original),
            )

            if detected_norm == "ko":
                logger.info("Patient ko detection — running false-positive filter")
                original = await asyncio.to_thread(
                    reconcile_patient_korean_false_positive, original
                )
                if not original:
                    raise ValueError("음성에서 텍스트를 인식하지 못했습니다.")
                display_lang = current_session_lang or DEFAULT_DOCTOR_TARGET_LANG
                return build_ui_payload(
                    {
                        "type": "result",
                        "speaker": "patient",
                        "original": original,
                        "translated": original,
                        "detected_language": display_lang,
                        "detected_language_label_ko": (
                            label_ko_for_code(display_lang)
                            if current_session_lang
                            else "자동 감지 (한국어 오인식 보정)"
                        ),
                        "source_language": "ko",
                        "session_lang": current_session_lang,
                        "language_locked": current_session_lang is not None,
                    }
                )

        if not original:
            raise ValueError("음성에서 텍스트를 인식하지 못했습니다.")

        if speaker == "doctor":
            dest_lang = resolve_patient_target_lang()
            logger.info(
                "Doctor speech: whisper_source=%s → translate target=%s (override=%r)",
                detected_source,
                dest_lang,
                target_lang,
            )
            translated = await asyncio.to_thread(
                translate_text,
                original,
                detected_source,
                dest_lang,
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


@app.post("/api/transcribe")
async def api_transcribe(
    audio: UploadFile = File(...),
    target_lang: str = Form(""),
    manual_lang: str = Form(""),
):
    """
    의사 녹음: multipart/form-data로 오디오 파일과 메타데이터를 분리 수신.
    WebSocket과 분리된 안전한 HTTP 파이프라인.
    """
    audio_bytes = await audio.read()

    logger.info(
        "POST /api/transcribe bytes=%d filename=%r content_type=%r",
        len(audio_bytes),
        audio.filename,
        audio.content_type,
    )

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="오디오 파일이 비어 있습니다.")

    manual = (manual_lang or "").strip()
    target = (target_lang or "").strip()
    target_override = manual if manual else (target if target else None)

    await broadcast_patient_status("processing", speaker="doctor")
    try:
        result = await process_audio_session(
            audio_bytes=audio_bytes,
            speaker="doctor",
            target_lang=target_override,
            upload_filename=audio.filename,
        )
        await manager.broadcast(result)
        await broadcast_patient_status("ready", speaker="doctor")
        return result
    except Exception as exc:
        logger.exception("api/transcribe failed")
        await manager.broadcast(
            {"type": "error", "message": str(exc), "speaker": "doctor"}
        )
        await broadcast_patient_status("ready", speaker="doctor")
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    global patient_remote_chunks

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

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            # 의사 오디오는 POST /api/transcribe (multipart) 전용 — WebSocket 바이너리 무시
            if message.get("bytes") is not None:
                continue

            raw = message.get("text")
            if not raw:
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Invalid JSON from %s: %r", client_addr, raw[:120])
                continue

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
                await broadcast_patient_status("processing", speaker="patient")
                continue

            if msg_type == "patient_audio":
                if manager.get_role(websocket) != "display":
                    continue
                phase = msg.get("phase")
                if phase == "chunk":
                    data_b64 = msg.get("data")
                    if isinstance(data_b64, str) and data_b64.strip():
                        try:
                            patient_remote_chunks.append(
                                decode_audio_chunk_b64(data_b64)
                            )
                        except ValueError as exc:
                            logger.warning("Patient audio chunk skipped: %s", exc)
                elif phase == "end":
                    try:
                        await broadcast_patient_status("processing", speaker="patient")
                        result = await process_audio_session(
                            audio_bytes=b"".join(patient_remote_chunks),
                            speaker="patient",
                        )
                        await manager.broadcast(result)
                        await broadcast_patient_status("ready", speaker="patient")
                    except Exception as exc:
                        await manager.broadcast(
                            {
                                "type": "error",
                                "message": str(exc),
                                "speaker": "patient",
                            }
                        )
                        await broadcast_patient_status("ready", speaker="patient")
                    patient_remote_chunks.clear()
                continue

            if msg_type == "register":
                manager.register(websocket, msg.get("role", "display"))
                await websocket.send_json(
                    {"type": "registered", "role": manager.get_role(websocket)}
                )
                await websocket.send_json(session_state_payload())
                continue

            if msg_type == "state_change":
                if manager.get_role(websocket) != "doctor":
                    continue
                await relay_doctor_state_change(msg)
                state_val = (msg.get("state") or "").strip()
                if state_val == "patient_speaking":
                    patient_remote_chunks.clear()
                    await manager.send_to_displays(
                        {"type": "remote_patient_record", "phase": "start"}
                    )
                elif state_val == "processing" and msg.get("speaker") == "patient":
                    await manager.send_to_displays(
                        {"type": "remote_patient_record", "phase": "stop"}
                    )
                continue

            if msg_type == "status":
                if manager.get_role(websocket) != "doctor":
                    continue
                status = msg.get("status")
                if status in PATIENT_UI_STATUSES:
                    await broadcast_patient_status(
                        status, speaker=msg.get("speaker", "doctor")
                    )
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
                    await broadcast_patient_status("ready", speaker="doctor")
                continue

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("WebSocket 연결 종료 | client=%s", client_addr)
        manager.disconnect(websocket)
