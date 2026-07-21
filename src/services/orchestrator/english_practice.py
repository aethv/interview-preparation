"""Prompt builders for english_practice sessions.

Kept separate from the interview prompts so the two personas can never bleed
into each other: nothing in this module mentions interviews, hiring, resumes,
code, or the sandbox.

The session brief arrives in state["job_description"] built by the frontend as:

    [ENGLISH PRACTICE]
    Skill: Speaking | Level: Intermediate

    <scenario_prompt>

    Key vocabulary: ...
    Evaluation criteria: ...
"""

import re
from typing import Any, Optional

from pydantic import BaseModel, Field


class Correction(BaseModel):
    """One thing the learner said, and a better way to say it."""

    said: str = Field(..., description="What the learner actually said (quoted)")
    better: str = Field(..., description="A more natural or correct phrasing")
    why: str = Field("", description="One short clause explaining the change")


# How the partner reacts when the learner speaks their first language.
#
# Speaking L1 is not a failure to be brushed aside — for a learner it marks the
# exact point where they ran out of English, which is the most useful moment in
# the session. How much help that earns depends on level: a Beginner needs the
# words, an Advanced learner needs the pressure.
L1_POLICY_TEMPLATES: dict[str, str] = {
    "Beginner": (
        "The learner may use their own language when stuck. When they do:\n"
        "- Reply warmly in {language}, never in their language.\n"
        "- Give them the {language} for what they just said, as a short natural phrase.\n"
        "- Invite them to say it back, then carry on with the scene.\n"
        "- Set native_language_used, and put that phrase in english_version."
    ),
    "Intermediate": (
        "The learner should stay in {language}. When they use their own language:\n"
        "- Reply in {language} and give the {language} phrase for what they said, briefly.\n"
        "- Nudge them back: something like \"try that one in {language}\".\n"
        "- Do not dwell on it; keep the scene moving.\n"
        "- Set native_language_used, and put that phrase in english_version."
    ),
    "Advanced": (
        "The learner is expected to stay in {language} throughout. When they use their\n"
        "own language:\n"
        "- Ask them, kindly but firmly, to say it in {language}. Do NOT translate for them.\n"
        "- Offer at most a hint (a single word) if they are clearly stuck twice in a row.\n"
        "- Leave english_version empty; set native_language_used."
    ),
}

# Topics marked "Any" get the middle policy.
DEFAULT_L1_POLICY_LEVEL = "Intermediate"


def get_l1_policy(level: str | None, language: str = "English") -> str:
    """Policy text for the learner's level, defaulting to the middle ground."""
    template = L1_POLICY_TEMPLATES.get(
        level or "", L1_POLICY_TEMPLATES[DEFAULT_L1_POLICY_LEVEL])
    return template.format(language=language)


class EnglishTurn(BaseModel):
    """One conversational turn plus anything worth surfacing in the UI.

    The correction and vocabulary fields ride along on the turn the agent was
    going to generate anyway, so live coaching costs no additional LLM calls.
    """

    message: str = Field(..., description="What you say next, in role, spoken aloud")
    correction: Optional[Correction] = Field(
        None,
        description="Set only when the learner made a real mistake worth fixing this turn",
    )
    vocabulary_used: list[str] = Field(
        default_factory=list,
        description="Key vocabulary items the learner used in their last message",
    )
    native_language_used: bool = Field(
        False,
        description="True when the learner's last message was not in English",
    )
    english_version: str = Field(
        "",
        description=(
            "The English phrase for what they said in their own language. "
            "Follow the level policy: leave empty when the policy says not to translate."
        ),
    )


class EnglishFeedback(BaseModel):
    """End-of-session language feedback.

    Deliberately separate from InterviewFeedback: an English session is scored on
    language, not on engineering signal, so reusing the interview rubric would
    produce a meaningless code_quality score.

    `overall_score` is included because the analytics layer reads that key to
    chart a user's progress over time.
    """

    summary: str = Field(..., description="2-3 sentence spoken summary of how the session went")
    fluency_score: float = Field(..., ge=0.0, le=1.0)
    grammar_score: float = Field(..., ge=0.0, le=1.0)
    vocabulary_score: float = Field(..., ge=0.0, le=1.0)
    task_completion_score: float = Field(
        ..., ge=0.0, le=1.0, description="How well they achieved the scenario's goal")
    overall_score: float = Field(..., ge=0.0, le=1.0)
    strengths: list[str] = Field(default_factory=list, description="2-3 specific strengths")
    weaknesses: list[str] = Field(default_factory=list, description="2-3 areas to work on")
    recommendations: list[str] = Field(default_factory=list, description="2-3 next steps")
    corrections: list[Correction] = Field(
        default_factory=list, description="Up to 5 concrete corrections")
    vocabulary_used: list[str] = Field(
        default_factory=list, description="Key vocabulary items the learner actually used")
    vocabulary_missed: list[str] = Field(
        default_factory=list, description="Key vocabulary items they never used")
    language_switches: int = Field(
        0, description="How many times the learner fell back to their own language")
    phrases_to_learn: list[Correction] = Field(
        default_factory=list,
        description=(
            "For each moment they switched language: what they wanted to say "
            "(in `said`) and the English for it (in `better`)"
        ),
    )

# Labels the frontend writes in the scene block -> canonical scene keys.
# Keep in sync with buildEnglishPracticeJobDescription in the frontend.
SCENE_LABELS: dict[str, str] = {
    "scene": "title",
    "you play": "ai_role",
    "the learner plays": "your_role",
    "setting": "setting",
    "learner's goal": "goal",
    "opening line": "opening_line",
}

PARTNER_RULES_TEMPLATE = (
    "You are a friendly native {language} speaker helping someone practise spoken "
    "{language} through a roleplay scenario.\n"
    "- This is a conversation practice session, not a job interview and not a coding exercise.\n"
    "- Never suggest writing, running, reviewing or discussing code, and never mention a "
    "code editor, sandbox or programming task, whatever the scenario is about.\n"
    "- Stay in your role in the scenario.\n"
    "- Keep your turns short so the learner does most of the talking.\n"
    "- Speak naturally at the learner's level; simplify for Beginner, stretch for Advanced.\n"
    "- Correct gently and in passing, by restating what they said in better {language}, "
    "then continuing. Do not lecture and do not stop the scene for grammar.\n"
    "- Work the key vocabulary into the conversation so the learner has a reason to use it."
)


def get_partner_rules(language: str = "English") -> str:
    """System rules for the conversation partner in the topic's language."""
    return PARTNER_RULES_TEMPLATE.format(language=language)


# Back-compat for callers that predate multi-language support.
ENGLISH_PARTNER_RULES = get_partner_rules("English")


def parse_session_brief(job_description: str | None) -> dict[str, Any]:
    """Extract skill, level, scenario, vocabulary and criteria from the brief.

    Tolerant by design: a missing or malformed brief yields empty fields rather
    than raising, so a session started from an older row still runs.
    """
    brief = job_description or ""
    body = brief.replace("[ENGLISH PRACTICE]", "").strip()

    # Optional "Language: X" line, absent on briefs written before multi-language
    # support — those are English by definition.
    language = ""
    lang_match = re.search(r"^Language:\s*([^\n]+)$", body, re.M)
    if lang_match:
        language = lang_match.group(1).strip()
        body = (body[:lang_match.start()] + body[lang_match.end():]).strip()

    skill = level = ""
    header = re.search(r"Skill:\s*([^|\n]+)\|\s*Level:\s*([^\n]+)", body)
    if header:
        skill = header.group(1).strip()
        level = header.group(2).strip()
        body = body[header.end():].strip()

    # Optional chosen-scene block, written by the frontend when the learner
    # picked a scene. Parsed out so it can be rendered as its own section.
    scene: dict[str, str] = {}
    scene_match = re.search(r"^Scene:.+?(?=\n\n|\Z)", body, re.S | re.M)
    if scene_match:
        for line in scene_match.group(0).splitlines():
            label, _, value = line.partition(":")
            key = SCENE_LABELS.get(label.strip().lstrip("-").strip().lower())
            if key and value.strip():
                scene[key] = value.strip()
        body = (body[:scene_match.start()] + body[scene_match.end():]).strip()

    # Trailing sections are stripped back-to-front so that removing one does not
    # truncate the section after it; what remains in `body` is the scenario.
    criteria = ""
    criteria_match = re.search(r"Evaluation criteria:\s*(.+)", body, re.S)
    if criteria_match:
        criteria = criteria_match.group(1).strip()
        body = body[:criteria_match.start()].strip()

    vocabulary = ""
    vocab_match = re.search(r"Key vocabulary:\s*(.+)", body, re.S)
    if vocab_match:
        vocabulary = vocab_match.group(1).strip()
        body = body[:vocab_match.start()].strip()

    return {
        "target_language": language or "English",
        "skill_focus": skill,
        "level": level or "Any",
        "scenario": body.strip(),
        "scene": scene,
        "key_vocabulary": vocabulary,
        "evaluation_criteria": criteria,
    }


def build_scenario_context(state: dict) -> str:
    """Render the scenario block injected into every English-mode prompt."""
    brief = parse_session_brief(state.get("job_description"))

    lines = [
        f"Target language: {brief['target_language']}",
        f"Skill focus: {brief['skill_focus'] or 'General speaking'}",
        f"Learner level: {brief['level']}",
        "",
        "Scenario:",
        brief["scenario"] or "Open-ended everyday conversation.",
    ]

    # A picked scene is more specific than the topic's scenario, so it wins:
    # it tells the agent exactly who to be and what the learner is trying to do.
    scene = brief.get("scene") or {}
    if scene:
        lines.append("")
        lines.append("THIS SESSION'S SCENE (follow this, it overrides the general scenario):")
        for label, key in (
            ("Scene", "title"),
            ("You play", "ai_role"),
            ("The learner plays", "your_role"),
            ("Setting", "setting"),
            ("Learner's goal", "goal"),
        ):
            if scene.get(key):
                lines.append(f"- {label}: {scene[key]}")
    if brief["key_vocabulary"]:
        lines += ["", f"Key vocabulary to elicit: {brief['key_vocabulary']}"]
    if brief["evaluation_criteria"]:
        lines += ["", f"What you assess later: {brief['evaluation_criteria']}"]
    return "\n".join(lines)


def build_greeting_prompt(state: dict) -> str:
    candidate_name = state.get("candidate_name")
    first_name = candidate_name.split()[0] if candidate_name else None
    name_note = f"\nThe learner's name is {first_name}. Greet them by name." if first_name else ""

    scene = (parse_session_brief(state.get("job_description")).get("scene") or {})
    opening = scene.get("opening_line", "")
    opening_note = (
        f"\nOpen with this line, or something very close to it: \"{opening}\""
        if opening else ""
    )

    language = parse_session_brief(state.get("job_description"))["target_language"]

    return f"""Open a {language} conversation practice session.
{opening_note}

{build_scenario_context(state)}
{name_note}

Your greeting will be spoken aloud.
- Say hello warmly and briefly, in one or two short sentences.
- Set the scene: say who you are in this scenario and where you both are.
- Hand the conversation straight over with one simple opening question.
- Speak only in {language}.
- Do not explain the exercise, do not list rules, and do not mention grammar or scoring.
- Total length: under 60 words."""


def build_turn_prompt(state: dict, last_answer: str, conversation_context: str) -> str:
    brief = parse_session_brief(state.get("job_description"))
    brief_level = brief["level"]
    language = brief["target_language"]
    l1_policy = get_l1_policy(brief_level, language)

    return f"""Continue the English practice conversation, in role.

{build_scenario_context(state)}

Conversation so far:
{conversation_context}

The learner just said:
"{last_answer or '(nothing yet)'}"

For `message` (this will be spoken aloud):
- React to what they actually said, in role, then ask one follow-up question.
- If they made a clear mistake, restate their idea correctly in your reply as a natural
  echo, then move on. At most one correction per turn.
- Use or invite a key vocabulary item when it fits naturally.
- Keep it under 45 words. One question only.

For `correction`: set it only if they made a real mistake this turn, quoting what they
said and a better phrasing. Leave it empty for a turn with nothing worth correcting —
do not invent corrections, and do not flag accent or informal-but-correct speech.

For `vocabulary_used`: list only key vocabulary items that appear in their last message.

IF THE LEARNER DID NOT SPEAK {language} ({brief_level} level):
{l1_policy}

Speech recognition sometimes mislabels a short greeting as the wrong language.
If a word is plausibly an attempt at {language}, treat it as {language}."""


def build_evaluation_prompt(state: dict, transcript: str) -> str:
    brief = parse_session_brief(state.get("job_description"))
    criteria = brief["evaluation_criteria"] or (
        "fluency, grammar accuracy, vocabulary range, and clarity"
    )
    return f"""Give the learner feedback on their spoken {brief['target_language']} from this practice session.

Skill focus: {brief['skill_focus'] or 'General speaking'} | Level: {brief['level']}
Assess: {criteria}

Transcript:
{transcript}

Key vocabulary for this topic: {brief['key_vocabulary'] or 'none specified'}

The transcript marks turns where the learner fell back to their own language.
For each one, add an entry to phrases_to_learn: what they were trying to say in
`said`, and the {brief['target_language']} for it in `better`. Set language_switches to how many
such turns there were. These are the phrases they most need — treat them as the
headline of the feedback, not an afterthought.

Score fluency, grammar, vocabulary and task completion from 0 to 1, where 0.5 is
"appropriate for their stated level" — score against the {brief['level']} level of
{brief['target_language']}, not against a native speaker. Set overall_score as a weighted view of the four.

Quote the learner's own words in strengths and corrections. Split the key vocabulary
into what they actually used and what they never used. Never mention code,
programming, or job interviews."""


def _split_vocabulary(raw: str | None) -> list[str]:
    """Split the comma-separated key vocabulary field into clean items."""
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _phase_for(turn_count: int, status: str) -> tuple[str, str]:
    """Derive a human-readable phase and hint from turn count and status.

    Deliberately computed rather than read from graph state: graph state is not
    persisted between turns, and a phase label is not worth a database column.
    """
    if status == "completed":
        return "wrap-up", "Session finished. Your feedback is ready below."
    if turn_count <= 1:
        return "warm-up", "Settle in and answer naturally."
    if turn_count <= 6:
        return "scenario", "You're in the scene. Keep the conversation going."
    if turn_count <= 12:
        return "stretch", "Try longer answers and the key vocabulary."
    return "wrap-up", "Wind down, or ask for feedback whenever you're ready."


def _english_only_streak(history: list[dict]) -> int:
    """Consecutive learner turns without falling back to another language.

    A small, honest progress signal: it rewards sustained English rather than
    total turn count.
    """
    streak = 0
    for msg in reversed(history or []):
        if msg.get("role") != "assistant":
            continue
        meta = msg.get("metadata") or {}
        if meta.get("type") == "english_turn" and meta.get("native_language"):
            break
        streak += 1
    return streak


def build_session_state(
    job_description: str | None,
    conversation_history: list[dict] | None,
    turn_count: int,
    status: str,
) -> dict[str, Any]:
    """Live state for the English practice side panel.

    Pure computation over data already stored on the interview row: no LLM call,
    so the panel can be polled cheaply during a session.
    """
    brief = parse_session_brief(job_description)
    scene = brief.get("scene") or {}
    history = conversation_history or []

    phase, phase_hint = _phase_for(turn_count, status)

    # Vocabulary is ticked off when the agent reported it, or when the learner's
    # own words contain it — the latter covers turns where the model stayed quiet.
    vocabulary = _split_vocabulary(brief.get("key_vocabulary"))
    learner_text = " ".join(
        msg.get("content", "") for msg in history if msg.get("role") == "user"
    ).lower()

    reported_used: set[str] = set()
    corrections: list[dict] = []
    language_switches: list[dict] = []
    for msg in history:
        meta = msg.get("metadata") or {}
        if meta.get("type") != "english_turn":
            continue
        for item in meta.get("vocabulary_used", []) or []:
            reported_used.add(str(item).strip().lower())
        if meta.get("correction"):
            corrections.append({
                **meta["correction"],
                "at": msg.get("timestamp"),
            })
        if meta.get("native_language"):
            language_switches.append({
                **meta["native_language"],
                "at": msg.get("timestamp"),
            })

    vocabulary_state = [
        {
            "word": word,
            "used": word.lower() in reported_used or word.lower() in learner_text,
        }
        for word in vocabulary
    ]

    learner_turns = sum(1 for msg in history if msg.get("role") == "user")

    return {
        "session_mode": "language_practice",
        "target_language": brief["target_language"],
        "phase": phase,
        "phase_hint": phase_hint,
        "skill_focus": brief.get("skill_focus") or "",
        "level": brief.get("level") or "Any",
        "scene": {
            "title": scene.get("title", ""),
            "your_role": scene.get("your_role", ""),
            "ai_role": scene.get("ai_role", ""),
            "setting": scene.get("setting", ""),
            "goal": scene.get("goal", ""),
        } if scene else None,
        "objective": scene.get("goal") or brief.get("scenario", "")[:200],
        "vocabulary": vocabulary_state,
        "vocabulary_used_count": sum(1 for v in vocabulary_state if v["used"]),
        "corrections": corrections,
        "language_switches": language_switches,
        "english_only_streak": _english_only_streak(history),
        "turn_count": turn_count,
        "learner_turns": learner_turns,
        "status": status,
    }


def build_spoken_feedback(feedback: "EnglishFeedback") -> str:
    """Render the structured feedback as something natural to say aloud."""
    parts = [feedback.summary]

    if feedback.strengths:
        parts.append("What worked well: " + "; ".join(feedback.strengths[:2]) + ".")

    if feedback.corrections:
        fixes = [f"you said {c.said}, more natural is {c.better}"
                 for c in feedback.corrections[:2]]
        parts.append("A couple of small fixes. " + ". ".join(fixes) + ".")

    if feedback.phrases_to_learn:
        first = feedback.phrases_to_learn[0]
        parts.append(
            f"When you switched to your own language, the English you wanted was: {first.better}."
        )

    if feedback.recommendations:
        parts.append("Next time, " + feedback.recommendations[0])

    return " ".join(parts)
