"""Resource management for the interview agent.

This module handles bootstrapping and managing agent resources including
database connections, orchestrator LLM, TTS, STT, and VAD components.
"""

import asyncio
import logging
from typing import TYPE_CHECKING

from livekit.agents import JobContext, stt, tts, vad

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from src.agents.orchestrator_llm import OrchestratorLLM
    from livekit.agents import AgentSession

logger = logging.getLogger(__name__)


class AgentResources:
    """Resource container for agent components with proper cleanup."""

    def __init__(self, interview_id: int):
        self.interview_id = interview_id
        self.db: "AsyncSession | None" = None
        self.orchestrator_llm: "OrchestratorLLM | None" = None
        self.tts: tts.TTS | None = None
        self.stt: stt.STT | None = None
        self.vad: vad.VAD | None = None
        self.session: "AgentSession | None" = None

    async def aclose(self):
        """Clean up all resources."""
        # Clean up orchestrator state if it exists
        if self.orchestrator_llm and self.orchestrator_llm.orchestrator:
            try:
                await self.orchestrator_llm.orchestrator.cleanup_interview(self.interview_id)
            except Exception as e:
                logger.error(
                    f"Failed to cleanup orchestrator during resource cleanup: {e}", exc_info=True)

        if self.db:
            await self.db.close()
            self.db = None


# Per-process VAD cache with thread-safe lazy loading
_vad: vad.VAD | None = None
_vad_lock = asyncio.Lock()


async def get_vad() -> vad.VAD | None:
    """Get VAD instance with per-process lazy caching.

    Loads Silero VAD asynchronously in executor to avoid blocking event loop.
    Returns None if loading fails (graceful degradation).

    CRITICAL: Only called after handshake completes.
    """
    global _vad

    # Return cached instance if already loaded
    if _vad is not None:
        return _vad

    # Thread-safe lazy loading: acquire lock before loading
    async with _vad_lock:
        # Double-check pattern: another coroutine may have loaded it while waiting
        if _vad is not None:
            return _vad

        try:
            # Defer import until after LiveKit handshake completes
            from livekit.plugins import silero

            loop = asyncio.get_running_loop()
            # Load in executor to avoid blocking the event loop
            _vad = await loop.run_in_executor(None, silero.VAD.load)
            return _vad
        except Exception as e:
            logger.error(f"VAD loading failed: {e}", exc_info=True)
            # Graceful degradation: return None if loading fails
            return None


async def bootstrap_resources(ctx: JobContext, interview_id: int) -> AgentResources:
    """Bootstrap all agent resources after handshake completes.

    This is the SAFE ZONE - handshake is complete, we can do heavy operations.
    All heavy imports happen here, not at module level.
    """
    resources = AgentResources(interview_id)

    try:
        # Defer heavy imports until after LiveKit handshake completes
        from src.core.database import AsyncSessionLocal
        from src.core.config import settings
        from livekit.plugins import openai
        from src.agents.orchestrator_llm import OrchestratorLLM

        # Initialize database session from connection pool
        resources.db = AsyncSessionLocal()

        # Warm the secret cache before any vendor client is built, so an
        # admin-managed key applies in the agent process too.
        try:
            from src.services.data.secret_service import load_secrets
            await load_secrets(resources.db)
        except Exception as e:
            logger.warning(f"Could not load managed secrets, using environment: {e}")

        # Initialize orchestrator LLM with two-phase initialization pattern
        # This avoids blocking the LiveKit handshake with heavy imports
        resources.orchestrator_llm = OrchestratorLLM(interview_id)
        await resources.orchestrator_llm.init(resources.db)

        # The LiveKit OpenAI plugins read OPENAI_API_KEY from the environment by
        # default, which would ignore a key managed in Admin. Pass it explicitly.
        from src.core.secrets import openai_api_key
        api_key = openai_api_key()
        if not api_key:
            logger.error(
                "No OpenAI API key available (checked Admin secrets and "
                "OPENAI_API_KEY). Speech-to-text and text-to-speech will not work."
            )

        # Initialize TTS with graceful error handling
        try:
            resources.tts = openai.TTS(
                voice=settings.OPENAI_TTS_VOICE or "alloy",
                model=settings.OPENAI_TTS_MODEL or "tts-1-hd",
                api_key=api_key or None,
            )
        except Exception as e:
            logger.exception("TTS creation failed, will retry later")
            resources.tts = None

        # Initialize STT with graceful error handling
        try:
            resources.stt = openai.STT(api_key=api_key or None)
        except Exception as e:
            logger.exception("STT creation failed, will retry later")
            resources.stt = None

        # Initialize VAD: required for OpenAI non-streaming STT to function properly
        # Loading occurs during bootstrap (before connection), so initialization delay is acceptable
        # VAD is loaded asynchronously in an executor thread to prevent event loop blocking
        try:
            resources.vad = await get_vad()
            if not resources.vad:
                logger.error(
                    "VAD loading failed - STT may not work properly without VAD")
        except Exception as e:
            logger.exception("VAD loading failed, STT may not work properly")
            resources.vad = None

        return resources

    except Exception as e:
        logger.error(f"Bootstrap failed: {e}", exc_info=True)
        await resources.aclose()
        raise
