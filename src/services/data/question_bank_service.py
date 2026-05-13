"""Question bank service — CRUD, embedding generation, and similarity search."""

import logging
from typing import Optional
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from src.core.config import settings
from src.models.question_bank import QuestionBank
from src.schemas.question_bank import QuestionCreate, QuestionUpdate, BankSearchResult

logger = logging.getLogger(__name__)

_EMBED_MODEL = "text-embedding-3-small"
_EMBED_DIM = 1536
_SIMILARITY_THRESHOLD = 0.85   # cosine similarity above this → duplicate
_SIMILAR_THRESHOLD = 0.70      # above this → similar (warn but allow)


def _openai_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


async def embed_text(text: str) -> list[float]:
    """Generate a 1536-dim embedding for the given text."""
    client = _openai_client()
    resp = await client.embeddings.create(model=_EMBED_MODEL, input=text[:8000])
    return resp.data[0].embedding


async def get_question(db: AsyncSession, question_id: int) -> QuestionBank | None:
    result = await db.execute(select(QuestionBank).where(QuestionBank.id == question_id))
    return result.scalar_one_or_none()


async def list_questions(
    db: AsyncSession,
    category: Optional[str] = None,
    level: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
) -> tuple[list[QuestionBank], int]:
    query = select(QuestionBank)
    if category:
        query = query.where(QuestionBank.category == category)
    if level:
        query = query.where(QuestionBank.level == level)
    if search:
        like = f"%{search}%"
        query = query.where(
            or_(
                QuestionBank.question.ilike(like),
                QuestionBank.topic.ilike(like),
                QuestionBank.subcategory.ilike(like),
            )
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    query = query.order_by(QuestionBank.category, QuestionBank.level, QuestionBank.id)
    query = query.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(query)).scalars().all()
    return list(rows), total


async def _set_embedding(db: AsyncSession, question_id: int, embedding: list[float]) -> None:
    """Write an embedding vector via raw SQL to avoid asyncpg VARCHAR-to-vector type mismatch.

    Uses CAST(:vec AS vector) rather than :vec::vector because SQLAlchemy's text()
    parser treats :: as part of the parameter name, breaking the substitution.
    """
    from sqlalchemy import text
    vec_literal = "[" + ",".join(f"{x:.8f}" for x in embedding) + "]"
    await db.execute(
        text("UPDATE question_bank SET embedding = CAST(:vec AS vector) WHERE id = :id"),
        {"vec": vec_literal, "id": question_id},
    )


async def create_question(db: AsyncSession, data: QuestionCreate) -> QuestionBank:
    # Insert without embedding to avoid type mismatch; set embedding via raw SQL after
    q = QuestionBank(
        category=data.category,
        subcategory=data.subcategory,
        level=data.level,
        topic=data.topic,
        question=data.question,
        answer=data.answer,
        source=data.source,
    )
    db.add(q)
    await db.commit()
    await db.refresh(q)

    try:
        embedding = await embed_text(f"{data.question}\n{data.answer}")
        await _set_embedding(db, q.id, embedding)
        await db.commit()
    except Exception as e:
        logger.warning(f"Embedding failed, question saved without vector: {e}")

    return q


async def update_question(
    db: AsyncSession, question_id: int, data: QuestionUpdate
) -> QuestionBank | None:
    q = await get_question(db, question_id)
    if not q:
        return None

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(q, field, value)

    await db.commit()
    await db.refresh(q)

    if data.question or data.answer:
        try:
            embedding = await embed_text(f"{q.question}\n{q.answer}")
            await _set_embedding(db, q.id, embedding)
            await db.commit()
        except Exception as e:
            logger.warning(f"Embedding update failed: {e}")

    return q


async def delete_question(db: AsyncSession, question_id: int) -> bool:
    q = await get_question(db, question_id)
    if not q:
        return False
    await db.delete(q)
    await db.commit()
    return True


async def search_similar(
    db: AsyncSession,
    embedding: list[float],
    limit: int = 5,
    exclude_ids: Optional[list[int]] = None,
    category: Optional[str] = None,
) -> list[tuple[QuestionBank, float]]:
    """Find the most similar questions using cosine similarity (pgvector via raw SQL)."""
    from sqlalchemy import text as sql_text

    vec_literal = "[" + ",".join(f"{x:.8f}" for x in embedding) + "]"

    # Build filter clauses
    filters = ["embedding IS NOT NULL"]
    params: dict = {"vec": vec_literal, "lim": limit}
    if exclude_ids:
        filters.append("id != ALL(:excl)")
        params["excl"] = exclude_ids
    if category:
        filters.append("category = :cat")
        params["cat"] = category
    where_clause = " AND ".join(filters)

    raw = sql_text(f"""
        SELECT id, 1 - (embedding <=> CAST(:vec AS vector)) AS similarity
        FROM question_bank
        WHERE {where_clause}
        ORDER BY similarity DESC
        LIMIT :lim
    """)

    try:
        rows = (await db.execute(raw, params)).fetchall()
    except Exception as e:
        logger.warning(f"Vector search failed: {e}")
        return []

    if not rows:
        return []

    # Batch-fetch full objects
    ids_in_order = [r.id for r in rows]
    sim_by_id = {r.id: float(r.similarity) for r in rows}
    result_rows = (await db.execute(
        select(QuestionBank).where(QuestionBank.id.in_(ids_in_order))
    )).scalars().all()
    obj_by_id = {q.id: q for q in result_rows}

    return [(obj_by_id[i], sim_by_id[i]) for i in ids_in_order if i in obj_by_id]


async def check_duplicate_status(
    db: AsyncSession, question_text: str, answer_text: str
) -> tuple[str, Optional[int], Optional[float]]:
    """
    Returns (status, similar_id, similarity_score).
    status: 'new' | 'similar' | 'duplicate'
    """
    try:
        embedding = await embed_text(f"{question_text}\n{answer_text}")
        results = await search_similar(db, embedding, limit=1)
        if not results:
            return "new", None, None
        _, score = results[0]
        similar_id = results[0][0].id
        if score >= _SIMILARITY_THRESHOLD:
            return "duplicate", similar_id, score
        if score >= _SIMILAR_THRESHOLD:
            return "similar", similar_id, score
        return "new", None, score
    except Exception:
        return "new", None, None


async def search_for_interview(
    db: AsyncSession,
    context_text: str,
    category: Optional[str] = None,
    limit: int = 5,
    exclude_questions: Optional[list[str]] = None,
) -> list[BankSearchResult]:
    """Find relevant questions for an interview context (used by orchestrator)."""
    try:
        embedding = await embed_text(context_text)
        results = await search_similar(db, embedding, limit=limit * 2, category=category)
    except Exception as e:
        logger.warning(f"Bank search failed: {e}")
        return []

    out = []
    seen_texts = set(exclude_questions or [])
    for q, score in results:
        if q.question in seen_texts:
            continue
        seen_texts.add(q.question)
        out.append(BankSearchResult(
            id=q.id, category=q.category, level=q.level,
            topic=q.topic, question=q.question, answer=q.answer,
            similarity=score,
        ))
        if len(out) >= limit:
            break
    return out


async def count_questions(db: AsyncSession) -> int:
    result = await db.execute(select(func.count()).select_from(QuestionBank))
    return result.scalar_one()
