"""Session mode — the single source of truth for what kind of session this is.

Three modes exist:
  - interview         : full mock interview (voice + code sandbox)
  - code_practice     : coding drill on a CodeTopic (voice + code sandbox)
  - language_practice : spoken conversation in the topic's target language
                        (voice ONLY, no code). Formerly "english_practice".

Historically the mode was inferred by string-sniffing markers in the interview
title / job_description. That inference now lives here and is used only to
classify legacy rows that predate the session_mode column.
"""

from typing import Final

MODE_INTERVIEW: Final = "interview"
MODE_CODE_PRACTICE: Final = "code_practice"
MODE_LANGUAGE_PRACTICE: Final = "language_practice"

# Former name of MODE_LANGUAGE_PRACTICE, kept so older clients and stored
# payloads keep working. Normalised away on read.
LEGACY_ENGLISH_PRACTICE: Final = "english_practice"

# Deprecated alias for imports that predate multi-language support.
MODE_ENGLISH_PRACTICE: Final = MODE_LANGUAGE_PRACTICE

SESSION_MODES: Final = (MODE_INTERVIEW, MODE_CODE_PRACTICE, MODE_LANGUAGE_PRACTICE)

ENGLISH_PRACTICE_MARKER: Final = "[ENGLISH PRACTICE]"
CODE_PRACTICE_MARKER: Final = "[CODE PRACTICE]"


def infer_session_mode(
    job_description: str | None,
    title: str | None = None,
) -> str:
    """Classify a legacy session that has no session_mode value.

    Kept in sync with the frontend fallback in lib/interview-session.ts.
    """
    jd = job_description or ""
    lowered_title = (title or "").lower()

    if ENGLISH_PRACTICE_MARKER in jd or lowered_title.startswith("english:"):
        return MODE_LANGUAGE_PRACTICE
    if CODE_PRACTICE_MARKER in jd or lowered_title.startswith("code:"):
        return MODE_CODE_PRACTICE
    return MODE_INTERVIEW


def normalize_session_mode(
    session_mode: str | None,
    job_description: str | None = None,
    title: str | None = None,
) -> str:
    """Return a valid mode, falling back to marker inference then to interview."""
    if session_mode == LEGACY_ENGLISH_PRACTICE:
        return MODE_LANGUAGE_PRACTICE
    if session_mode in SESSION_MODES:
        return session_mode
    return infer_session_mode(job_description, title)


def allows_code(session_mode: str | None) -> bool:
    """Whether the code sandbox, code review and coding exercises are available."""
    return normalize_session_mode(session_mode) != MODE_LANGUAGE_PRACTICE


def is_language_practice(session_mode: str | None) -> bool:
    """Spoken conversation practice in any target language."""
    return normalize_session_mode(session_mode) == MODE_LANGUAGE_PRACTICE


# Deprecated alias kept so existing call sites keep reading naturally.
is_english_practice = is_language_practice


def is_code_practice(session_mode: str | None) -> bool:
    return normalize_session_mode(session_mode) == MODE_CODE_PRACTICE
