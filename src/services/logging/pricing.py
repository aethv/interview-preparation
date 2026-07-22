"""Cost estimation from per-model token counts.

Prices are per 1,000,000 tokens, keyed by a case-insensitive substring of the
model name so a new snapshot suffix (gpt-5.4-mini-2026-xx) still matches its
family. Rates live in the admin config key `model_pricing`, so an admin can
adjust them without a deploy — model names and prices change often, and none of
these are knowable at build time.

Cost is an ESTIMATE. It excludes speech (STT/TTS) and embeddings, which are
billed per-second / per-token on separate schedules, and it depends on the
prices an admin entered. Surfaced as "approximate" in the UI for that reason.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# name-substring -> (input, cached_input, output) USD per 1M tokens.
# Longest match wins, so "gpt-5.4-mini" beats "gpt-5.4". Update in Admin, not here.
DEFAULT_PRICING: dict[str, dict[str, float]] = {
    "gpt-5.4-nano":  {"input": 0.20, "cached_input": 0.02, "output": 1.25},
    "gpt-5.4-mini":  {"input": 0.75, "cached_input": 0.075, "output": 4.50},
    "gpt-5.4":       {"input": 2.50, "cached_input": 0.25, "output": 15.00},
    "gpt-4o-mini":   {"input": 0.15, "cached_input": 0.075, "output": 0.60},
    "gpt-4o":        {"input": 2.50, "cached_input": 1.25, "output": 10.00},
}


def _rates_for(model: str, pricing: dict[str, dict[str, float]]) -> dict[str, float] | None:
    """Longest matching substring wins, so specific variants beat families."""
    lowered = (model or "").lower()
    best_key = None
    for key in pricing:
        if key.lower() in lowered and (best_key is None or len(key) > len(best_key)):
            best_key = key
    return pricing.get(best_key) if best_key else None


def cost_for_model(
    model: str,
    prompt_tokens: int,
    cached_tokens: int,
    completion_tokens: int,
    pricing: dict[str, dict[str, float]] | None = None,
) -> float:
    """USD cost for one model's usage. Cached tokens are billed at the cheaper rate."""
    table = pricing or DEFAULT_PRICING
    rates = _rates_for(model, table)
    if not rates:
        # Unknown model: no price rather than a wrong guess. Logged once per model.
        logger.debug("No pricing for model %r; cost counted as 0", model)
        return 0.0

    # prompt_tokens from the API already INCLUDES cached_tokens, so bill the
    # non-cached remainder at the full input rate and the cached part cheaper.
    fresh_input = max(0, prompt_tokens - cached_tokens)
    return (
        fresh_input * rates.get("input", 0.0)
        + cached_tokens * rates.get("cached_input", rates.get("input", 0.0))
        + completion_tokens * rates.get("output", 0.0)
    ) / 1_000_000.0


def cost_from_by_model(
    by_model: dict[str, dict[str, int]],
    pricing: dict[str, dict[str, float]] | None = None,
) -> float:
    """Total USD across every model used in a turn."""
    total = 0.0
    for model, counts in (by_model or {}).items():
        total += cost_for_model(
            model,
            int(counts.get("prompt_tokens", 0)),
            int(counts.get("cached_tokens", 0)),
            int(counts.get("completion_tokens", 0)),
            pricing,
        )
    return total


def resolve_pricing(config_value: Any) -> dict[str, dict[str, float]]:
    """Coerce the admin config value into a pricing table, falling back to defaults."""
    if not isinstance(config_value, dict) or not config_value:
        return DEFAULT_PRICING
    clean: dict[str, dict[str, float]] = {}
    for name, rates in config_value.items():
        if isinstance(rates, dict):
            clean[str(name)] = {k: float(v) for k, v in rates.items()
                                if isinstance(v, (int, float))}
    return clean or DEFAULT_PRICING
