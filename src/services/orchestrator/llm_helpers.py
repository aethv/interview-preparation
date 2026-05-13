"""Helper utilities for LLM calls in orchestrator nodes."""

import logging
from typing import Optional, Any
from openai import AsyncOpenAI
import instructor

from src.services.orchestrator.constants import (
    get_model,
    get_temperature_creative,
    get_temperature_balanced,
    get_temperature_analytical,
)

logger = logging.getLogger(__name__)


class LLMHelper:
    """Helper class for standardized LLM calls."""

    def __init__(self, openai_client: AsyncOpenAI):
        self.client = openai_client
        self._instructor_client = None

    @property
    def instructor_client(self):
        if self._instructor_client is None:
            self._instructor_client = instructor.patch(self.client)
        return self._instructor_client

    async def call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        temperature: float | None = None,
        response_format: Optional[dict] = None,
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=model or get_model(),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature if temperature is not None else get_temperature_balanced(),
                response_format=response_format,
            )
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
    ) -> Any:
        try:
            response = await self.instructor_client.chat.completions.create(
                model=model or get_model(),
                response_model=response_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature if temperature is not None else get_temperature_balanced(),
            )
            return response
        except Exception as e:
            logger.error(f"Instructor LLM call failed: {e}", exc_info=True)
            raise

    async def call_llm_creative(self, system_prompt: str, user_prompt: str, model: str | None = None) -> str:
        return await self.call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            temperature=get_temperature_creative(),
        )

    async def call_llm_analytical(self, system_prompt: str, user_prompt: str, model: str | None = None) -> str:
        return await self.call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            temperature=get_temperature_analytical(),
        )

    async def call_llm_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        temperature: float | None = None,
    ) -> str:
        return await self.call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            temperature=temperature,
            response_format={"type": "json_object"},
        )
