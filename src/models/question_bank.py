"""Question bank model.

The `embedding` column (vector(1536)) is NOT mapped in the ORM — it is managed
exclusively via raw SQL in question_bank_service.py using explicit ::vector casts.
SQLAlchemy's asyncpg dialect rejects implicit varchar→vector coercion, so we
keep the ORM clean and do all vector I/O through sqlalchemy.text() queries.
"""

from datetime import datetime
from sqlalchemy import String, Text, DateTime, func, Integer
from sqlalchemy.orm import Mapped, mapped_column

from src.core.database import Base


class QuestionBank(Base):
    __tablename__ = "question_bank"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    subcategory: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    level: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(String(200), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # embedding column (vector(1536)) exists in DB but is not mapped here — see above
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
