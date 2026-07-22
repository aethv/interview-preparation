"""AgentConfigService — loads agent config from DB with in-memory cache."""

import time
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Cache TTL: 60 seconds so agent picks up changes without restart
_CACHE_TTL = 60.0

_cache: dict[str, Any] = {}
_cache_loaded_at: float = 0.0

# (default_value, description)
_DEFAULTS: dict[str, tuple[Any, str]] = {
    "model": (
        "gpt-4o-mini",
        "Default OpenAI model — used when a role-specific model below is blank",
    ),
    # Role-specific models. Blank means "use `model`". Splitting them lets the
    # cheap control-plane calls run on a small model while the text the user
    # actually hears comes from a stronger one.
    "model_decision": (
        "",
        "Model for intent detection, action routing, answer scoring and summaries (cheapest)",
    ),
    "model_conversation": (
        "",
        "Model for greeting, questions, follow-ups and closing — the user hears this output",
    ),
    "model_evaluation": (
        "",
        "Model for final feedback and code review (strongest)",
    ),
    "temperature_creative": (
        0.8,
        "Temperature for greeting and sandbox guidance (higher = more creative)",
    ),
    "temperature_balanced": (
        0.7,
        "Temperature for decision and persona generation",
    ),
    "temperature_analytical": (
        0.3,
        "Temperature for analysis, scoring, and summaries",
    ),
    "temperature_question": (
        0.85,
        "Temperature for question generation",
    ),
    "system_prompt": (
        (
            "You are an authentic interviewer having a natural conversation. "
            "Your responses will be spoken aloud.\n\n"
            "Core principles:\n"
            "- Be authentic and genuine - not formulaic or robotic\n"
            "- Be natural and conversational - not sycophantic or overly enthusiastic\n"
            "- You have full context of the conversation, resume, and job requirements\n"
            "- Trust your judgment and adapt to the conversation flow\n"
            "- Use shorter sentences. Break up long thoughts. Speak like a real person, not a formal document.\n"
            "- Vary your sentence length. Mix short and medium sentences for natural flow.\n"
            "- Be direct and clear. Avoid unnecessary words or overly complex phrasing.\n"
            "- If you know the candidate's name, use it naturally and appropriately"
        ),
        "Base system prompt injected into every LLM call",
    ),
    "summary_update_interval": (
        5,
        "Regenerate conversation summary every N turns",
    ),
    "max_conversation_length_for_summary": (
        30,
        "Force summary regeneration when history exceeds this length",
    ),
    "sandbox_poll_interval_seconds": (
        10.0,
        "How often (seconds) to poll sandbox for code changes",
    ),
    "sandbox_stuck_threshold_seconds": (
        30.0,
        "Seconds of inactivity before offering a hint",
    ),
    "skill_weight_communication": (
        0.25,
        "Weight of communication score in overall score (0–1)",
    ),
    "skill_weight_technical": (
        0.30,
        "Weight of technical score in overall score (0–1)",
    ),
    "skill_weight_problem_solving": (
        0.25,
        "Weight of problem-solving score in overall score (0–1)",
    ),
    "skill_weight_code_quality": (
        0.20,
        "Weight of code quality score in overall score (0–1)",
    ),
    "practice_languages": (
        ["English", "Japanese", "Chinese", "Korean", "Spanish", "French", "Vietnamese"],
        "Languages available for conversation practice. Admin-editable: add one here "
        "and it appears in the topic form and the practice filter (content still "
        "needs writing for it).",
    ),
    "model_pricing": (
        {
            "gpt-5.6-luna": {"input": 1.00, "cached_input": 0.10, "output": 6.00},
            "gpt-5.6-terra": {"input": 2.50, "cached_input": 0.25, "output": 15.00},
            "gpt-5.6-sol": {"input": 5.00, "cached_input": 0.50, "output": 30.00},
            "gpt-5.4-nano": {"input": 0.20, "cached_input": 0.02, "output": 1.25},
            "gpt-5.4-mini": {"input": 0.75, "cached_input": 0.075, "output": 4.50},
            "gpt-5.4": {"input": 2.50, "cached_input": 0.25, "output": 15.00},
            "gpt-4o-mini": {"input": 0.15, "cached_input": 0.075, "output": 0.60},
            "gpt-4o": {"input": 2.50, "cached_input": 1.25, "output": 10.00},
        },
        "USD per 1M tokens per model, used for the session cost estimate. "
        "Longest name match wins. Excludes speech and embeddings.",
    ),
    "tts_voice": (
        "alloy",
        "OpenAI TTS voice (alloy, echo, fable, onyx, nova, shimmer)",
    ),
    "tts_model": (
        "tts-1-hd",
        "OpenAI TTS model (tts-1 or tts-1-hd)",
    ),
}


class AgentConfigService:

    @staticmethod
    def get_defaults() -> dict[str, tuple[Any, str]]:
        return _DEFAULTS

    @staticmethod
    def invalidate_cache() -> None:
        global _cache_loaded_at
        _cache_loaded_at = 0.0
        _cache.clear()
        logger.info("AgentConfig cache invalidated")

    @staticmethod
    async def load(db) -> dict[str, Any]:
        """Return config dict, refreshing from DB if cache is stale."""
        global _cache, _cache_loaded_at

        now = time.monotonic()
        if _cache and (now - _cache_loaded_at) < _CACHE_TTL:
            return _cache

        from sqlalchemy import select
        from src.models.agent_config import AgentConfig

        result = await db.execute(select(AgentConfig))
        rows = result.scalars().all()
        loaded = {r.key: r.value for r in rows}

        # Seed any missing defaults
        if len(loaded) < len(_DEFAULTS):
            for key, (default_val, description) in _DEFAULTS.items():
                if key not in loaded:
                    row = AgentConfig(key=key, value=default_val, description=description)
                    db.add(row)
                    loaded[key] = default_val
            try:
                await db.commit()
            except Exception as e:
                logger.warning(f"Could not seed defaults: {e}")
                await db.rollback()

        _cache = loaded
        _cache_loaded_at = now
        return _cache

    @staticmethod
    def get_cached(key: str, fallback: Any = None) -> Any:
        """Synchronous read from in-memory cache (returns fallback if not loaded yet)."""
        return _cache.get(key, fallback)
