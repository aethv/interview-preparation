"""Interview model."""

from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, JSON, Integer, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.core.database import Base


class Interview(Base):
    """Interview model for storing interview sessions."""

    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True)
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resumes.id"), nullable=True, index=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(50), default="pending", nullable=False
    )  # pending, in_progress, completed, cancelled

    # interview | code_practice | english_practice — see src/core/session_modes.py.
    # english_practice sessions never expose the code sandbox or code nodes.
    session_mode: Mapped[str] = mapped_column(
        String(30), default="interview", server_default="interview",
        nullable=False, index=True
    )

    conversation_history: Mapped[list | None] = mapped_column(
        JSON, nullable=True, default=list
    )
    resume_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    job_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    turn_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # LLM usage, accumulated per turn so a paused/left session still counts.
    # cost is an estimate (chat only; excludes speech + embeddings).
    llm_calls: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False)
    llm_prompt_tokens: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False)
    llm_cached_tokens: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False)
    llm_completion_tokens: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False)
    llm_cost_usd: Mapped[float] = mapped_column(
        Numeric(12, 6), default=0, server_default="0", nullable=False)

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="interviews")
    resume: Mapped["Resume | None"] = relationship(
        "Resume", back_populates="interviews")

    def __repr__(self) -> str:
        return f"<Interview(id={self.id}, user_id={self.user_id}, status={self.status})>"
