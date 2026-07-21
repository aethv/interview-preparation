"""Control nodes for interview orchestrator.

This module contains all control nodes: initialize, ingest_input, detect_intent,
decide_next_action, and finalize_turn.
"""

import logging
import json
from typing import TYPE_CHECKING
from datetime import datetime
from openai import AsyncOpenAI

from src.core.session_modes import is_english_practice
from src.services.orchestrator.types import (
    InterviewState, NextActionDecision, EnglishNextActionDecision
)
from src.services.orchestrator.context_builders import (
    build_decision_context, build_control_context
)
from src.services.orchestrator.constants import (
    get_system_prompt,
    get_summary_interval, get_max_conversation_length,
    get_temperature_analytical, get_temperature_balanced, get_model,
    get_decision_model,
)
from src.services.orchestrator.intent_detection import detect_user_intent

logger = logging.getLogger(__name__)

# Decision rubrics are static, so they belong in the system message rather than
# being re-interpolated into the user prompt each turn.
INTERVIEW_DECISION_SYSTEM_PROMPT = """You are an experienced interviewer with full autonomy deciding the next action. \
Make decisions based on what feels natural and productive. Trust your judgment - if the conversation is going well, \
continue. If it needs a change, make it. If it feels complete, wrap it up.

AVAILABLE ACTIONS:
- greeting: First interaction only
- question: New question about background (can transition to new topics naturally)
- followup: Deeper dive into last answer
- sandbox_guidance: Guide to code sandbox (auto-generates exercises, provides hints)
- code_review: Review submitted code (executes and analyzes)
- evaluation: Comprehensive interview evaluation
- closing: End interview

DECISION PRINCIPLES:
- Follow natural conversation flow
- Don't repeat same action consecutively
- Respect user's explicit requests (evaluate, move on, etc.)
- Use sandbox_guidance proactively for technical roles
- Adapt interview length based on quality, not turn counts
- Maintain variety - don't repeat same action type 2-3+ times
- Use question to naturally transition to new topics when needed

Choose: greeting, question, followup, sandbox_guidance, code_review, evaluation, closing"""

ENGLISH_DECISION_SYSTEM_PROMPT = """You are a warm, patient English conversation partner running a roleplay \
practice session, deciding the next action. You never turn the session into a technical interview or a coding exercise.

AVAILABLE ACTIONS:
- greeting: First interaction only, set the scene
- question: Move the scenario forward with a new prompt or turn in the roleplay
- followup: React to what they just said and dig into it, correcting gently if useful
- evaluation: Summarize how their English performed this session
- closing: Wrap up the conversation

DECISION PRINCIPLES:
- This is a spoken English practice session, NOT a job interview and NOT a coding session
- Never propose writing, running or reviewing code, and never mention a code editor or sandbox
- Keep the learner talking as much as possible; you speak less than they do
- Stay inside the scenario; use followup when their answer opens something worth exploring
- Respect explicit requests (finish, feedback, change topic)
- Move to evaluation when the scenario has played out or the learner asks for feedback

Choose: greeting, question, followup, evaluation, closing"""


class ControlNodeMixin:
    """Mixin containing all control node methods."""

    async def initialize_node(self, state: InterviewState) -> InterviewState:
        """Initialize interview state with required fields.

        Idempotent: safe to call multiple times. Handles partial states from checkpoints.
        """
        defaults = {
            "conversation_history": [],
            "questions_asked": [],
            "detected_intents": [],
            "checkpoints": [],
            "sandbox": {
                "is_active": False,
                "last_activity_ts": 0.0,
                "submissions": [],
                "signals": [],
                "hints_provided": [],
                "initial_code": "",
                "exercise_description": "",
                "exercise_difficulty": "medium",
                "exercise_hints": [],
                "last_code_snapshot": "",
                "last_poll_time": 0.0,
            },
            "turn_count": 0,
            "phase": "intro",
            "session_mode": "interview",
            "code_submissions": [],
            "conversation_summary": "No conversation yet.",
            "candidate_name": None,
            "current_question": None,
            "active_user_request": None,
            "answer_quality": 0.0,
            "last_node": "initialize",
        }

        updates = {}
        for key, default_value in defaults.items():
            # Handle both missing keys and None values (but not empty lists/dicts which are valid)
            if key not in state or state.get(key) is None:
                updates[key] = default_value
            # Special case: if sandbox exists but is not a dict, reset it
            elif key == "sandbox" and not isinstance(state.get(key), dict):
                updates[key] = default_value

        if "topics_covered" not in state:
            updates["topics_covered"] = []

        return updates

    async def ingest_input_node(self, state: InterviewState) -> InterviewState:
        """Ingest user input and code submission into state.

        Single entry point for external data (LangGraph best practice).
        """
        updates = {
            "last_node": "ingest_input",
        }

        if state.get("last_response"):
            updates["turn_count"] = state.get("turn_count", 0) + 1

        updates["next_message"] = None

        return updates

    async def detect_intent_node(self, state: InterviewState) -> InterviewState:
        """Detect user intent from their last response."""
        if not state.get("last_response"):
            return {
                "active_user_request": None,
                "last_node": "detect_intent",
            }

        updates = await detect_user_intent(
            state,
            self.openai_client,
            self.interview_logger
        )

        return {
            **updates,
            "last_node": "detect_intent",
        }

    async def decide_next_action_node(self, state: InterviewState) -> InterviewState:
        """Decide which action node to execute next using LLM decision."""

        active_request = state.get("active_user_request")
        if active_request and self.interview_logger:
            self.interview_logger.log_intent_detection(
                state.get("last_response", ""),
                active_request
            )

        decision_ctx = build_decision_context(state, self.interview_logger)

        answer_quality = 0.0
        if state.get("last_response") and state.get("current_question"):
            try:
                analysis = await self.response_analyzer.analyze_answer(
                    state.get("current_question", ""),
                    state.get("last_response", ""),
                    {"resume_context": state.get("resume_structured", {})},
                )
                answer_quality = analysis.quality_score
            except Exception:
                pass

        # Summary + last few truncated messages instead of 20 full ones: the
        # decision only needs recent flow, and this stops the prompt growing
        # linearly with session length.
        conversation_text = build_control_context(state)

        intent_info = ""
        if active_request:
            intent_info = f"\nDetected User Intent: {active_request.get('type')} (confidence: {active_request.get('confidence', 0):.2f})\nUser's last response: {state.get('last_response', '')}\n"
            if active_request.get('metadata'):
                intent_info += f"Intent metadata: {json.dumps(active_request.get('metadata'), indent=2)}\n"

        english_mode = is_english_practice(state.get("session_mode"))

        # Static rubric lives in the system message (stable prefix), only
        # per-turn state goes in the user message.
        if english_mode:
            # English practice: conversation partner, not interviewer. No code
            # actions are offered here and none exist in EnglishNextActionDecision.
            decision_system_prompt = ENGLISH_DECISION_SYSTEM_PROMPT
            decision_model = EnglishNextActionDecision
            state_block = (
                f"- Turn: {decision_ctx['turn']}, Phase: {decision_ctx['phase']}\n"
                f"- Exchanges so far: {decision_ctx['questions_count']}"
            )
        else:
            decision_system_prompt = INTERVIEW_DECISION_SYSTEM_PROMPT
            decision_model = NextActionDecision
            state_block = (
                f"- Turn: {decision_ctx['turn']}, Phase: {decision_ctx['phase']}\n"
                f"- Questions: {decision_ctx['questions_count']}, Quality: {answer_quality:.2f}\n"
                f"- Sandbox: {'Active' if state.get('sandbox', {}).get('is_active') else 'Inactive'}\n"
                f"- Code: {'Yes' if state.get('current_code') else 'No'}"
            )

        prompt = f"""CONVERSATION:
{conversation_text}

STATE:
{state_block}
{intent_info}
Topics: {', '.join(decision_ctx.get('topics_covered', []) or ['None'])}

Choose the next action."""

        try:
            decision = await self.llm_helper.call_llm_with_instructor(
                system_prompt=decision_system_prompt,
                user_prompt=prompt,
                response_model=decision_model,
                temperature=get_temperature_balanced(),
                model=get_decision_model(),
                role="routing",
            )

            # Trust LLM decision - it has full context and can avoid repetition naturally
            return {
                "next_node": decision.action,
                "last_node": "decide_next_action",
                "answer_quality": answer_quality,
            }

        except Exception as e:
            logger.warning(f"LLM decision failed: {e}, using fallback")
            # Simple fallback - just default to question to keep conversation flowing
            conversation_history = state.get("conversation_history", [])
            has_assistant_messages = any(
                msg.get("role") == "assistant" for msg in conversation_history
            )

            if not has_assistant_messages:
                action = "greeting"
            else:
                action = "question"

            return {
                "next_node": action,
                "last_node": "decide_next_action",
                "answer_quality": answer_quality,
            }

    async def finalize_turn_node(self, state: InterviewState) -> InterviewState:
        """Finalize the turn by writing conversation history and updating summary.

        This is the SINGLE writer for conversation_history.
        Following LangGraph best practice: one node writes append-only fields.

        This node:
        1. Writes user message (if last_response exists)
        2. Writes assistant message (if next_message exists)
        3. Updates turn metadata
        4. Updates conversation summary periodically
        """

        updates = {
            "last_node": "finalize_turn",
        }

        # Add user message if present
        user_messages = []
        if state.get("last_response"):
            user_messages.append({
                "role": "user",
                "content": state["last_response"],
                "timestamp": datetime.utcnow().isoformat(),
            })

        # Add assistant message if present
        assistant_messages = []
        if state.get("next_message"):
            message = {
                "role": "assistant",
                "content": state["next_message"],
                "timestamp": datetime.utcnow().isoformat(),
            }
            # Nodes may attach structured extras (e.g. an English correction) that
            # the live session panel reads back out of the transcript.
            if state.get("next_message_metadata"):
                message["metadata"] = state["next_message_metadata"]
            assistant_messages.append(message)

        # Return messages to append (reducer will handle the append)
        # CRITICAL: Only add messages that aren't already in conversation_history
        # This prevents duplication when state is restored from checkpoints
        existing_history = state.get("conversation_history", [])
        messages_to_add = []

        def _is_message_duplicate(msg_to_check: dict, existing: list) -> bool:
            """Check if a message already exists in history."""
            return any(
                existing_msg.get("role") == msg_to_check.get("role") and
                existing_msg.get("content") == msg_to_check.get("content")
                for existing_msg in existing
            )

        for msg in user_messages + assistant_messages:
            if not _is_message_duplicate(msg, existing_history):
                messages_to_add.append(msg)

        if messages_to_add:
            updates["conversation_history"] = messages_to_add

        updates["last_response"] = None
        updates["next_node"] = None
        # Clear code after processing to prevent re-routing to code_review
        updates["current_code"] = None
        # Metadata belongs to the message just written; clear it so the next turn
        # cannot inherit a stale correction.
        updates["next_message_metadata"] = None
        # next_message preserved until next turn starts (allows reading after graph execution)

        # Update conversation summary periodically (merged from update_summary_node)
        conversation_history = state.get("conversation_history", [])
        current_summary = state.get("conversation_summary", "")
        turn_count = state.get("turn_count", 0)

        should_update = (
            turn_count % get_summary_interval() == 0 or
            not current_summary or
            len(conversation_history) > get_max_conversation_length()
        )

        if should_update:
            recent_messages = conversation_history[-10:] if len(
                conversation_history) > 10 else conversation_history
            recent_context = "\n".join([
                f"{msg.get('role', 'unknown').upper()}: {msg.get('content', '')[:200]}"
                for msg in recent_messages
            ])

            prompt = f"""You are summarizing an interview conversation to maintain context.

CURRENT SUMMARY:
{current_summary if current_summary else "No summary yet."}

RECENT CONVERSATION (last 10 messages):
{recent_context}

Create or update a concise summary (2-3 sentences) that captures:
- Key topics discussed
- Important points about the candidate
- Current phase of the interview
- Any notable achievements or code submissions

Return ONLY the summary text, no additional formatting."""

            try:
                new_summary = await self.llm_helper.call_llm_analytical(
                    system_prompt="You are a conversation summarizer. Create concise, informative summaries that preserve key context.",
                    user_prompt=prompt,
                )
                updates["conversation_summary"] = new_summary
            except Exception as e:
                logger.error(
                    f"Failed to update conversation summary: {e}", exc_info=True)

        return updates
