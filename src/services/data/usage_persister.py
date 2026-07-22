"""Accumulate one turn's LLM usage onto the interview row.

Uses an atomic SQL increment (col = col + :delta) rather than read-modify-write,
so overlapping turns can never lose an update. Best-effort: any failure is
swallowed, because accounting must never break a live session.
"""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.logging.pricing import cost_from_by_model, resolve_pricing
from src.services.logging.token_usage import UsageTotals

logger = logging.getLogger(__name__)


async def accumulate_usage(
    db: AsyncSession, interview_id: int, usage: UsageTotals
) -> None:
    """Add this turn's tokens and estimated cost to the interview totals."""
    if not usage or usage.calls == 0:
        return

    try:
        # Price from the admin-configured table (falls back to defaults). A
        # failed config read can leave the session in an aborted transaction, so
        # roll back before the UPDATE rather than let it poison the write.
        try:
            from src.services.orchestrator.config_service import AgentConfigService
            cfg = await AgentConfigService.load(db)
            pricing = resolve_pricing(cfg.get("model_pricing"))
        except Exception:
            try:
                await db.rollback()
            except Exception:
                pass
            pricing = resolve_pricing(None)

        turn_cost = cost_from_by_model(usage.by_model, pricing)

        await db.execute(
            text(
                """
                UPDATE interviews SET
                    llm_calls = llm_calls + :calls,
                    llm_prompt_tokens = llm_prompt_tokens + :prompt,
                    llm_cached_tokens = llm_cached_tokens + :cached,
                    llm_completion_tokens = llm_completion_tokens + :completion,
                    llm_cost_usd = llm_cost_usd + :cost
                WHERE id = :id
                """
            ),
            {
                "calls": usage.calls,
                "prompt": usage.prompt_tokens,
                "cached": usage.cached_tokens,
                "completion": usage.completion_tokens,
                "cost": turn_cost,
                "id": interview_id,
            },
        )
        await db.commit()
    except Exception as e:
        logger.warning(f"Could not persist usage for interview {interview_id}: {e}")
        try:
            await db.rollback()
        except Exception:
            pass
