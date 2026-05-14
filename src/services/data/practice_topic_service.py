"""Practice topic service — CRUD for EnglishTopic and CodeTopic."""

import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from src.models.practice_topics import EnglishTopic, CodeTopic
from src.schemas.practice_topics import (
    EnglishTopicCreate, EnglishTopicUpdate,
    CodeTopicCreate, CodeTopicUpdate,
)

logger = logging.getLogger(__name__)


# ── English Topics ─────────────────────────────────────────────────────────────

async def get_english_topic(db: AsyncSession, topic_id: int) -> EnglishTopic | None:
    result = await db.execute(select(EnglishTopic).where(EnglishTopic.id == topic_id))
    return result.scalar_one_or_none()


async def list_english_topics(
    db: AsyncSession,
    skill_focus: Optional[str] = None,
    level: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    active_only: bool = False,
) -> tuple[list[EnglishTopic], int]:
    query = select(EnglishTopic)
    if skill_focus:
        query = query.where(EnglishTopic.skill_focus == skill_focus)
    if level:
        query = query.where(EnglishTopic.level == level)
    if active_only:
        query = query.where(EnglishTopic.is_active.is_(True))
    if search:
        like = f"%{search}%"
        query = query.where(
            or_(
                EnglishTopic.title.ilike(like),
                EnglishTopic.scenario_prompt.ilike(like),
            )
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    query = query.order_by(EnglishTopic.skill_focus, EnglishTopic.level, EnglishTopic.id)
    query = query.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(query)).scalars().all()
    return list(rows), total


async def create_english_topic(db: AsyncSession, data: EnglishTopicCreate) -> EnglishTopic:
    topic = EnglishTopic(
        title=data.title,
        skill_focus=data.skill_focus,
        level=data.level,
        scenario_prompt=data.scenario_prompt,
        key_vocabulary=data.key_vocabulary,
        evaluation_criteria=data.evaluation_criteria,
        source=data.source,
        is_active=data.is_active,
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    return topic


async def update_english_topic(
    db: AsyncSession, topic_id: int, data: EnglishTopicUpdate
) -> EnglishTopic | None:
    topic = await get_english_topic(db, topic_id)
    if not topic:
        return None
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(topic, field, value)
    await db.commit()
    await db.refresh(topic)
    return topic


async def delete_english_topic(db: AsyncSession, topic_id: int) -> bool:
    topic = await get_english_topic(db, topic_id)
    if not topic:
        return False
    await db.delete(topic)
    await db.commit()
    return True


# ── Code Topics ────────────────────────────────────────────────────────────────

async def get_code_topic(db: AsyncSession, topic_id: int) -> CodeTopic | None:
    result = await db.execute(select(CodeTopic).where(CodeTopic.id == topic_id))
    return result.scalar_one_or_none()


async def list_code_topics(
    db: AsyncSession,
    category: Optional[str] = None,
    difficulty: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    active_only: bool = False,
) -> tuple[list[CodeTopic], int]:
    query = select(CodeTopic)
    if category:
        query = query.where(CodeTopic.category == category)
    if difficulty:
        query = query.where(CodeTopic.difficulty == difficulty)
    if active_only:
        query = query.where(CodeTopic.is_active.is_(True))
    if search:
        like = f"%{search}%"
        query = query.where(
            or_(
                CodeTopic.title.ilike(like),
                CodeTopic.problem_statement.ilike(like),
            )
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    query = query.order_by(CodeTopic.category, CodeTopic.difficulty, CodeTopic.id)
    query = query.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(query)).scalars().all()
    return list(rows), total


async def create_code_topic(db: AsyncSession, data: CodeTopicCreate) -> CodeTopic:
    topic = CodeTopic(
        title=data.title,
        category=data.category,
        difficulty=data.difficulty,
        languages=data.languages,
        problem_statement=data.problem_statement,
        discussion_hints=data.discussion_hints,
        review_rubric=data.review_rubric,
        reference_solution=data.reference_solution,
        source=data.source,
        is_active=data.is_active,
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    return topic


async def update_code_topic(
    db: AsyncSession, topic_id: int, data: CodeTopicUpdate
) -> CodeTopic | None:
    topic = await get_code_topic(db, topic_id)
    if not topic:
        return None
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(topic, field, value)
    await db.commit()
    await db.refresh(topic)
    return topic


async def delete_code_topic(db: AsyncSession, topic_id: int) -> bool:
    topic = await get_code_topic(db, topic_id)
    if not topic:
        return False
    await db.delete(topic)
    await db.commit()
    return True
