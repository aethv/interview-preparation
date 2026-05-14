from datetime import datetime
from sqlalchemy import String, Text, DateTime, Boolean, func, Integer
from sqlalchemy.orm import Mapped, mapped_column

from src.core.database import Base


class EnglishTopic(Base):
    __tablename__ = "english_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    skill_focus: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    scenario_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    key_vocabulary: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluation_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CodeTopic(Base):
    __tablename__ = "code_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    difficulty: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    languages: Mapped[str] = mapped_column(String(100), nullable=False, default="any")
    problem_statement: Mapped[str] = mapped_column(Text, nullable=False)
    discussion_hints: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_rubric: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_solution: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
