"""Export and import of admin-managed content as JSON.

Design rules:

- Import MERGES and SKIPS duplicates. Nothing is ever deleted or overwritten, so
  an import can be re-run safely and never destroys work someone did locally.
- Duplicates are detected on a natural key (see NATURAL_KEYS below), not on id:
  ids differ between environments and would make every import a duplicate-free
  free-for-all.
- Secrets are NEVER exported. API keys live in app_secrets, are encrypted at
  rest, and must not end up in a JSON file that gets emailed around.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.agent_config import AgentConfig
from src.models.practice_topics import CodeTopic, EnglishTopic
from src.models.question_bank import QuestionBank

logger = logging.getLogger(__name__)

EXPORT_VERSION = 1

# Config keys holding prompt overrides live in the same table as the rest of the
# agent settings; the admin UI splits them into two tabs by this prefix.
PROMPT_KEY_PREFIX = "prompt_"

DATASETS = ("agent_config", "prompts", "question_bank", "language_topics", "code_topics")


def _norm(value: Any) -> str:
    """Normalise a key part so trivial whitespace/case differences still match."""
    return str(value or "").strip().lower()


# dataset -> function producing the duplicate-detection key for one item
NATURAL_KEYS: dict[str, Callable[[dict], tuple]] = {
    "agent_config": lambda i: (_norm(i.get("key")),),
    "prompts": lambda i: (_norm(i.get("key")),),
    "question_bank": lambda i: (_norm(i.get("question")),),
    "language_topics": lambda i: (_norm(i.get("target_language") or "English"),
                                  _norm(i.get("title"))),
    "code_topics": lambda i: (_norm(i.get("title")),),
}


def _config_to_dict(row: AgentConfig) -> dict:
    return {"key": row.key, "value": row.value, "description": row.description}


def _question_to_dict(row: QuestionBank) -> dict:
    # embedding is deliberately omitted: it is derived data, large, and
    # regenerated on import.
    return {
        "category": row.category,
        "subcategory": row.subcategory,
        "level": row.level,
        "topic": row.topic,
        "question": row.question,
        "answer": row.answer,
        "source": row.source,
    }


def _language_topic_to_dict(row: EnglishTopic) -> dict:
    return {
        "title": row.title,
        "target_language": getattr(row, "target_language", None) or "English",
        "skill_focus": row.skill_focus,
        "level": row.level,
        "scenario_prompt": row.scenario_prompt,
        "scenes": row.scenes or [],
        "key_vocabulary": row.key_vocabulary,
        "evaluation_criteria": row.evaluation_criteria,
        "source": row.source,
        "is_active": row.is_active,
    }


def _code_topic_to_dict(row: CodeTopic) -> dict:
    return {
        "title": row.title,
        "category": row.category,
        "difficulty": row.difficulty,
        "languages": row.languages,
        "problem_statement": row.problem_statement,
        "discussion_hints": row.discussion_hints,
        "review_rubric": row.review_rubric,
        "reference_solution": row.reference_solution,
        "source": row.source,
        "is_active": row.is_active,
    }


async def export_dataset(db: AsyncSession, dataset: str) -> dict:
    """Serialise one admin dataset to a portable envelope."""
    if dataset not in DATASETS:
        raise ValueError(f"Unknown dataset: {dataset}")

    if dataset in ("agent_config", "prompts"):
        rows = (await db.execute(select(AgentConfig).order_by(AgentConfig.key))).scalars().all()
        wanted_prompts = dataset == "prompts"
        items = [
            _config_to_dict(r) for r in rows
            if r.key.startswith(PROMPT_KEY_PREFIX) == wanted_prompts
        ]
    elif dataset == "question_bank":
        rows = (await db.execute(select(QuestionBank).order_by(QuestionBank.id))).scalars().all()
        items = [_question_to_dict(r) for r in rows]
    elif dataset == "language_topics":
        rows = (await db.execute(select(EnglishTopic).order_by(EnglishTopic.id))).scalars().all()
        items = [_language_topic_to_dict(r) for r in rows]
    else:
        rows = (await db.execute(select(CodeTopic).order_by(CodeTopic.id))).scalars().all()
        items = [_code_topic_to_dict(r) for r in rows]

    return {
        "dataset": dataset,
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "count": len(items),
        "items": items,
    }


def parse_payload(dataset: str, payload: Any) -> list[dict]:
    """Accept either an export envelope or a bare list of items."""
    if isinstance(payload, dict):
        if payload.get("dataset") and payload["dataset"] != dataset:
            raise ValueError(
                f"This file contains '{payload['dataset']}' data, not '{dataset}'."
            )
        items = payload.get("items")
    else:
        items = payload

    if not isinstance(items, list):
        raise ValueError("Expected a JSON list of items, or an export file containing one.")

    return [i for i in items if isinstance(i, dict)]


async def _existing_keys(db: AsyncSession, dataset: str) -> set[tuple]:
    """Natural keys already present, for duplicate detection."""
    key_of = NATURAL_KEYS[dataset]

    if dataset in ("agent_config", "prompts"):
        rows = (await db.execute(select(AgentConfig))).scalars().all()
        return {key_of(_config_to_dict(r)) for r in rows}
    if dataset == "question_bank":
        rows = (await db.execute(select(QuestionBank))).scalars().all()
        return {key_of(_question_to_dict(r)) for r in rows}
    if dataset == "language_topics":
        rows = (await db.execute(select(EnglishTopic))).scalars().all()
        return {key_of(_language_topic_to_dict(r)) for r in rows}
    rows = (await db.execute(select(CodeTopic))).scalars().all()
    return {key_of(_code_topic_to_dict(r)) for r in rows}


async def import_dataset(db: AsyncSession, dataset: str, payload: Any) -> dict:
    """Merge items in, skipping anything that already exists.

    Returns a summary: imported, skipped (duplicates), invalid (rejected rows).
    """
    if dataset not in DATASETS:
        raise ValueError(f"Unknown dataset: {dataset}")

    items = parse_payload(dataset, payload)
    key_of = NATURAL_KEYS[dataset]
    seen = await _existing_keys(db, dataset)

    imported = skipped = invalid = 0
    errors: list[str] = []
    new_questions: list[QuestionBank] = []

    for item in items:
        try:
            key = key_of(item)
        except Exception:
            invalid += 1
            continue

        # An empty key means the row is missing its identifying field
        if not any(part for part in key):
            invalid += 1
            errors.append("Row missing its identifying field (title/key/question)")
            continue

        # Validate BEFORE the duplicate check: a config key pasted into the
        # prompts tab already exists in agent_config, so checking duplicates
        # first would report it as "already present" instead of "wrong tab".
        if dataset == "prompts" and not str(item.get("key", "")).startswith(PROMPT_KEY_PREFIX):
            invalid += 1
            errors.append(f"{item.get('key')} is not a prompt key")
            continue
        if dataset == "agent_config" and str(item.get("key", "")).startswith(PROMPT_KEY_PREFIX):
            invalid += 1
            errors.append(f"{item.get('key')} is a prompt, import it under Prompts")
            continue

        if key in seen:
            skipped += 1
            continue

        try:
            if dataset in ("agent_config", "prompts"):
                db.add(AgentConfig(
                    key=item["key"], value=item.get("value"),
                    description=item.get("description"),
                ))
            elif dataset == "question_bank":
                row = QuestionBank(
                    category=item.get("category") or "General",
                    subcategory=item.get("subcategory"),
                    level=item.get("level") or "Mid",
                    topic=item.get("topic") or item["question"][:200],
                    question=item["question"],
                    answer=item.get("answer") or "",
                    source=item.get("source"),
                )
                db.add(row)
                new_questions.append(row)
            elif dataset == "language_topics":
                db.add(EnglishTopic(
                    title=item["title"],
                    target_language=item.get("target_language") or "English",
                    skill_focus=item.get("skill_focus") or "Speaking",
                    level=item.get("level") or "Any",
                    scenario_prompt=item.get("scenario_prompt") or "",
                    scenes=item.get("scenes") or None,
                    key_vocabulary=item.get("key_vocabulary"),
                    evaluation_criteria=item.get("evaluation_criteria"),
                    source=item.get("source"),
                    is_active=bool(item.get("is_active", True)),
                ))
            else:
                db.add(CodeTopic(
                    title=item["title"],
                    category=item.get("category") or "General",
                    difficulty=item.get("difficulty") or "Mid",
                    languages=item.get("languages") or "any",
                    problem_statement=item.get("problem_statement") or "",
                    discussion_hints=item.get("discussion_hints"),
                    review_rubric=item.get("review_rubric"),
                    reference_solution=item.get("reference_solution"),
                    source=item.get("source"),
                    is_active=bool(item.get("is_active", True)),
                ))
        except KeyError as e:
            invalid += 1
            errors.append(f"Missing required field: {e}")
            continue

        seen.add(key)
        imported += 1

    await db.commit()

    # Questions need an embedding to be findable by similarity search. Best
    # effort: a failure here must not undo a successful import.
    embedded = 0
    if new_questions:
        from src.services.data.question_bank_service import _set_embedding, embed_text
        for row in new_questions:
            try:
                await db.refresh(row)
                vector = await embed_text(f"{row.question}\n{row.answer}")
                await _set_embedding(db, row.id, vector)
                embedded += 1
            except Exception as e:
                logger.warning(f"Embedding failed for imported question {row.id}: {e}")
        try:
            await db.commit()
        except Exception:
            await db.rollback()

    summary = {
        "dataset": dataset,
        "imported": imported,
        "skipped": skipped,
        "invalid": invalid,
        "errors": errors[:10],
    }
    if new_questions:
        summary["embedded"] = embedded

    logger.info("Import %s: %s", dataset, summary)
    return summary
