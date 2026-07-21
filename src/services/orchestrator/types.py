"""Type definitions for the interview orchestrator."""

import operator
from typing import TypedDict, Literal, Optional, Annotated
from pydantic import BaseModel, Field


# ============================================================================
# STATE TYPES
# ============================================================================

def _dedupe(items: list, key) -> list:
    """Keep the first occurrence of each key, preserving order."""
    seen = set()
    out = []
    for item in items:
        try:
            k = key(item)
        except Exception:
            # Unkeyable entries are kept as-is rather than dropped
            out.append(item)
            continue
        if k in seen:
            continue
        seen.add(k)
        out.append(item)
    return out


def _merge_by(key):
    """Build a LangGraph reducer that appends but never duplicates.

    plain operator.add was wrong here. Every turn re-seeds the graph with the
    full history loaded from the database, and LangGraph applies the reducer to
    that input as well — so the existing checkpoint and the incoming snapshot
    were concatenated, doubling the conversation on every single turn.
    """
    def reducer(left: list | None, right: list | None) -> list:
        return _dedupe(list(left or []) + list(right or []), key)
    return reducer


# Identity of a message: same speaker, same words, same moment.
merge_messages = _merge_by(
    lambda m: (m.get("role"), m.get("content"), m.get("timestamp"))
)
merge_questions = _merge_by(
    lambda q: q.get("id") or (q.get("text"), q.get("asked_at_turn"))
)
merge_intents = _merge_by(
    lambda i: (i.get("turn"), i.get("type"), i.get("extracted_from"))
)
merge_code_submissions = _merge_by(
    lambda s: (s.get("timestamp"), s.get("code"))
)
merge_checkpoints = _merge_by(lambda c: c)


class QuestionRecord(TypedDict):
    """Record of a question asked during the interview."""
    id: str
    text: str
    source: str  # resume | followup | user_request
    resume_anchor: Optional[str]  # project_1, skill_python, etc.
    aspect: str  # challenges, impact, design, tradeoffs, implementation, etc.
    asked_at_turn: int


class UserIntent(TypedDict):
    """Detected user intent from their response."""
    type: str  # technical_assessment | change_topic | clarify | stop | continue | write_code | review_code | show_code | no_intent
    confidence: float  # 0.0-1.0
    extracted_from: str  # raw text that triggered this intent
    turn: int
    metadata: Optional[dict]  # Additional context


# Simplified: Just track topics covered, no complex anchor/aspect/depth tracking
# The LLM can handle question generation without this complexity


class SandboxState(TypedDict):
    """State of code sandbox activity."""
    is_active: bool
    last_activity_ts: float  # Unix timestamp
    submissions: list[dict]  # Code submissions with results
    # struggling, confident, refactoring, idle, syntax_errors, rapid_iterations
    signals: list[str]
    initial_code: str  # Code provided by agent (exercise starter)
    exercise_description: str  # Problem description
    exercise_difficulty: str  # easy, medium, hard
    exercise_hints: list[str]  # Hints for the exercise
    last_code_snapshot: str  # Last code seen during polling
    last_poll_time: float  # Timestamp of last poll


class InterviewState(TypedDict):
    """Robust state schema for LangGraph interview workflow with reducers.

    Append-only fields use de-duplicating reducers (see _merge_by): the graph is
    re-seeded from the database each turn, so a plain concatenation would double
    the stored lists on every execution.
    This ensures state updates are atomic and prevents last-writer-wins bugs.
    """
    # Core identifiers
    interview_id: int
    user_id: int
    resume_id: int | None
    candidate_name: str | None  # User's name for personalization

    # Conversation - APPEND ONLY (uses reducer)
    turn_count: int
    conversation_history: Annotated[list[dict], merge_messages]

    # Questions tracking - APPEND ONLY (uses reducer)
    questions_asked: Annotated[list[QuestionRecord], merge_questions]
    current_question: str | None

    # Resume understanding
    resume_structured: dict  # parsed resume data
    # Simple list of topics covered (e.g., ["Project X", "Python", "Team Leadership"])
    # NOTE: This is NOT a reducer field - topics are manually merged in nodes to allow deduplication
    topics_covered: list[str]

    # Job context
    job_description: str | None

    # interview | code_practice | english_practice (src/core/session_modes.py)
    session_mode: str

    # User intent - APPEND ONLY (uses reducer)
    detected_intents: Annotated[list[UserIntent], merge_intents]
    active_user_request: UserIntent | None

    # Sandbox / code
    sandbox: SandboxState

    # Flow control
    phase: str  # intro | exploration | technical | closing
    last_node: str
    next_node: str | None

    # Runtime fields
    answer_quality: float
    next_message: str | None  # AI's next message to send
    # Structured extras attached to the next assistant message (e.g. corrections)
    next_message_metadata: dict | None
    last_response: str | None  # User's last response
    current_code: str | None
    code_execution_result: dict | None
    code_quality: dict | None
    # APPEND ONLY (uses reducer)
    code_submissions: Annotated[list[dict], merge_code_submissions]
    feedback: dict | None

    # Conversation summary (for memory management)
    conversation_summary: str  # Summarized conversation for long interviews

    # System
    # APPEND ONLY (uses reducer)
    checkpoints: Annotated[list[str], merge_checkpoints]


# ============================================================================
# PYDANTIC MODELS FOR LLM INTEGRATION
# ============================================================================

class UserIntentDetection(BaseModel):
    """LLM-driven user intent detection."""
    intent_type: Literal[
        "write_code", "review_code", "technical_assessment", "change_topic",
        "clarify", "stop", "continue", "no_intent"
    ] = Field(..., description="Type of user intent")
    confidence: float = Field(..., ge=0.0, le=1.0,
                              description="Confidence score")
    reasoning: str = Field(..., description="Why this intent was detected")
    metadata: dict = Field(default_factory=dict,
                           description="Additional context")


class NextActionDecision(BaseModel):
    """LLM-driven decision on what to do next."""
    action: Literal[
        "greeting", "question", "followup", "closing",
        "evaluation", "sandbox_guidance", "code_review"
    ] = Field(..., description="What action to take next")
    reasoning: str = Field(...,
                           description="Brief reasoning for this decision")


class EnglishNextActionDecision(BaseModel):
    """Decision model for english_practice sessions.

    Deliberately a separate model: the code actions are absent from the Literal,
    so the LLM is structurally unable to pick sandbox_guidance / code_review.
    """
    action: Literal[
        "greeting", "question", "followup", "evaluation", "closing"
    ] = Field(..., description="What action to take next")
    reasoning: str = Field(...,
                           description="Brief reasoning for this decision")


class QuestionGeneration(BaseModel):
    """Generated question with metadata."""
    question: str = Field(..., description="The question text")
    resume_anchor: Optional[str] = Field(
        None, description="Which resume anchor this relates to")
    aspect: str = Field(...,
                        description="What aspect we're exploring (challenges, impact, etc.)")
    reasoning: str = Field(..., description="Why this question was chosen")
