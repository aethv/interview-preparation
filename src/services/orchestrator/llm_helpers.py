"""Helper utilities for LLM calls in orchestrator nodes."""

import logging
from typing import Optional, Any
from openai import AsyncOpenAI
import instructor

from src.services.orchestrator.constants import (
    get_model,
    get_conversation_model,
    get_decision_model,
    get_temperature_creative,
    get_temperature_balanced,
    get_temperature_analytical,
)
from src.services.logging.token_usage import record_usage

logger = logging.getLogger(__name__)


class LLMHelper:
    """Helper class for standardized LLM calls."""

    def __init__(self, openai_client: AsyncOpenAI):
        self.client = openai_client
        self._instructor_client = None

    @property
    def instructor_client(self):
        if self._instructor_client is None:
            # Mode.JSON instead of the default Mode.TOOLS: TOOLS forces a
            # tool_choice on the request, which some reasoning-tier models
            # (e.g. gpt-5.6-luna, configurable as model_conversation) reject,
            # making every structured call fail and fall back to canned
            # replies. JSON mode requests a JSON completion instead — the
            # same plain-completion path already proven to work on the
            # configured models.
            self._instructor_client = instructor.patch(
                self.client, mode=instructor.Mode.JSON)
        return self._instructor_client

    async def call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        temperature: float | None = None,
        response_format: Optional[dict] = None,
        role: str = "conversation",
    ) -> str:
        resolved_model = model or get_model()
        try:
            response = await self.client.chat.completions.create(
                model=resolved_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature if temperature is not None else get_temperature_balanced(),
                response_format=response_format,
            )
            record_usage(resolved_model, role, response)
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"LLM call failed: {e}", exc_info=True)
            raise

    async def call_llm_with_instructor(
        self,
        system_prompt: str,
        user_prompt: str,
        response_model: Any,
        model: str | None = None,
        temperature: float | None = None,
        role: str = "decision",
    ) -> Any:
        resolved_model = model or get_model()
        try:
            response = await self.instructor_client.chat.completions.create(
                model=resolved_model,
                response_model=response_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature if temperature is not None else get_temperature_balanced(),
            )
            # instructor returns the parsed model; the raw completion (and its
            # usage block) is attached to it.
            record_usage(resolved_model, role,
                         getattr(response, "_raw_response", None))
            return response
        except Exception as e:
            logger.error(f"Instructor LLM call failed: {e}", exc_info=True)
            raise

    async def call_llm_creative(self, system_prompt: str, user_prompt: str, model: str | None = None) -> str:
        """Spoken output — defaults to the conversation model."""
        return await self.call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model or get_conversation_model(),
            temperature=get_temperature_creative(),
            role="conversation",
        )

    async def call_llm_analytical(self, system_prompt: str, user_prompt: str, model: str | None = None) -> str:
        """Scoring and summarizing — defaults to the cheap decision model."""
        return await self.call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model or get_decision_model(),
            temperature=get_temperature_analytical(),
            role="decision",
        )

    async def call_llm_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        temperature: float | None = None,
        role: str = "conversation",
    ) -> str:
        return await self.call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            temperature=temperature,
            response_format={"type": "json_object"},
            role=role,
        )
