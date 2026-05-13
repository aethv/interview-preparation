"""Constants for interview orchestrator nodes.

Static values are used as fallbacks. At runtime the orchestrator reads live
values from AgentConfigService (DB-backed, cached for 60 s).
"""

from src.services.orchestrator.config_service import AgentConfigService as _cfg

# Base system prompt — fallback used before DB is loaded
COMMON_SYSTEM_PROMPT = (
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
    "- If you know the candidate's name, use it naturally and appropriately\n\n"
    "Format for speech:\n"
    "- Avoid colons (use periods or commas instead)\n"
    "- Use commas instead of em dashes\n"
    "- Write percentages as '5 percent' not '5%'\n"
    "- Ensure sentences end with proper punctuation\n"
    "- Keep sentences under 20 words when possible."
)


def get_system_prompt() -> str:
    return _cfg.get_cached("system_prompt", COMMON_SYSTEM_PROMPT)


# LLM Configuration
DEFAULT_MODEL = "gpt-4o-mini"
TEMPERATURE_CREATIVE = 0.8
TEMPERATURE_BALANCED = 0.7
TEMPERATURE_ANALYTICAL = 0.3
TEMPERATURE_QUESTION = 0.85


def get_model() -> str:
    return _cfg.get_cached("model", DEFAULT_MODEL)


def get_temperature_creative() -> float:
    return float(_cfg.get_cached("temperature_creative", TEMPERATURE_CREATIVE))


def get_temperature_balanced() -> float:
    return float(_cfg.get_cached("temperature_balanced", TEMPERATURE_BALANCED))


def get_temperature_analytical() -> float:
    return float(_cfg.get_cached("temperature_analytical", TEMPERATURE_ANALYTICAL))


def get_temperature_question() -> float:
    return float(_cfg.get_cached("temperature_question", TEMPERATURE_QUESTION))


# Interview Flow Thresholds
SUMMARY_UPDATE_INTERVAL = 5
MAX_CONVERSATION_LENGTH_FOR_SUMMARY = 30


def get_summary_interval() -> int:
    return int(_cfg.get_cached("summary_update_interval", SUMMARY_UPDATE_INTERVAL))


def get_max_conversation_length() -> int:
    return int(_cfg.get_cached("max_conversation_length_for_summary", MAX_CONVERSATION_LENGTH_FOR_SUMMARY))


# Sandbox Monitoring
SANDBOX_POLL_INTERVAL_SECONDS = 10.0
SANDBOX_STUCK_THRESHOLD_SECONDS = 30.0


def get_sandbox_poll_interval() -> float:
    return float(_cfg.get_cached("sandbox_poll_interval_seconds", SANDBOX_POLL_INTERVAL_SECONDS))


def get_sandbox_stuck_threshold() -> float:
    return float(_cfg.get_cached("sandbox_stuck_threshold_seconds", SANDBOX_STUCK_THRESHOLD_SECONDS))
