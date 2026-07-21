"""Per-call and per-session LLM token accounting.

Every LLM call routed through LLMHelper reports its usage here. The totals are
scoped with a contextvar so concurrent interviews never mix, which matters
because a single orchestrator instance serves many rooms.

Usage:
    with track_usage(interview_id=42) as totals:
        ...run the graph...
    # totals is populated on exit and logged automatically
"""

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

logger = logging.getLogger(__name__)


@dataclass
class UsageTotals:
    """Accumulated token counts for one graph execution."""

    interview_id: Optional[int] = None
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    by_role: dict[str, dict[str, int]] = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def as_dict(self) -> dict[str, Any]:
        return {
            "interview_id": self.interview_id,
            "calls": self.calls,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "cached_tokens": self.cached_tokens,
            "total_tokens": self.total_tokens,
            "by_role": self.by_role,
        }


_current: ContextVar[Optional[UsageTotals]] = ContextVar(
    "llm_usage_totals", default=None)


@contextmanager
def track_usage(interview_id: Optional[int] = None) -> Iterator[UsageTotals]:
    """Collect usage for everything called inside this block."""
    totals = UsageTotals(interview_id=interview_id)
    token = _current.set(totals)
    try:
        yield totals
    finally:
        _current.reset(token)
        if totals.calls:
            logger.info(
                "LLM usage interview=%s calls=%d prompt=%d cached=%d completion=%d total=%d by_role=%s",
                interview_id, totals.calls, totals.prompt_tokens,
                totals.cached_tokens, totals.completion_tokens,
                totals.total_tokens, totals.by_role,
            )


def record_usage(model: str, role: str, raw_response: Any) -> None:
    """Extract usage from an OpenAI response and add it to the current totals.

    Never raises: accounting must not be able to break an interview.
    """
    try:
        usage = getattr(raw_response, "usage", None)
        if usage is None:
            return

        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)

        # Cached prefix tokens are billed at a discount; surfacing them shows
        # whether prompt-prefix caching is actually being hit.
        details = getattr(usage, "prompt_tokens_details", None)
        cached_tokens = int(getattr(details, "cached_tokens", 0) or 0) if details else 0

        logger.debug(
            "LLM call role=%s model=%s prompt=%d cached=%d completion=%d",
            role, model, prompt_tokens, cached_tokens, completion_tokens,
        )

        totals = _current.get()
        if totals is None:
            return

        totals.calls += 1
        totals.prompt_tokens += prompt_tokens
        totals.completion_tokens += completion_tokens
        totals.cached_tokens += cached_tokens

        bucket = totals.by_role.setdefault(
            role, {"calls": 0, "prompt_tokens": 0,
                   "completion_tokens": 0, "cached_tokens": 0},
        )
        bucket["calls"] += 1
        bucket["prompt_tokens"] += prompt_tokens
        bucket["completion_tokens"] += completion_tokens
        bucket["cached_tokens"] += cached_tokens
    except Exception as e:  # pragma: no cover - accounting is best-effort
        logger.debug(f"Could not record token usage: {e}")
