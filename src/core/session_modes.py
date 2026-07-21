"""Session mode — the single source of truth for what kind of session this is.

Three modes exist:
  - interview         : full mock interview (voice + code sandbox)
  - code_practice     : coding drill on a CodeTopic (voice + code sandbox)
  - english_practice   : English conversation on an EnglishTopic (voice ONLY, no code)

Historically the mode was inferred by string-sniffing markers in the interview
title / job_description. That inference now lives here and is used only to
classify legacy rows that predate the session_mode column.
"""

from typing import Final

MODE_INTERVIEW: Final = "interview"
MODE_CODE_PRACTICE: Final = "code_practice"
MODE_ENGLISH_PRACTICE: Final = "english_practice"

SESSION_MODES: Final = (MODE_INTERVIEW, MODE_CODE_PRACTICE, MODE_ENGLISH_PRACTICE)

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
        return MODE_ENGLISH_PRACTICE
    if CODE_PRACTICE_MARKER in jd or lowered_title.startswith("code:"):
        return MODE_CODE_PRACTICE
    return MODE_INTERVIEW


def normalize_session_mode(
    session_mode: str | None,
    job_description: str | None = None,
    title: str | None = None,
) -> str:
    """Return a valid mode, falling back to marker inference then to interview."""
    if session_mode in SESSION_MODES:
        return session_mode
    return infer_session_mode(job_description, title)


def allows_code(session_mode: str | None) -> bool:
    """Whether the code sandbox, code review and coding exercises are available."""
    return normalize_session_mode(session_mode) != MODE_ENGLISH_PRACTICE


def is_english_practice(session_mode: str | None) -> bool:
    return normalize_session_mode(session_mode) == MODE_ENGLISH_PRACTICE


def is_code_practice(session_mode: str | None) -> bool:
    return normalize_session_mode(session_mode) == MODE_CODE_PRACTICE
