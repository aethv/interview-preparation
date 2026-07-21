"""Stored third-party API keys (ciphertext only)."""

from datetime import datetime

from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.core.database import Base


class AppSecret(Base):
    """One managed secret.

    Deliberately a separate table from agent_config: that table is read wholesale
    by a public-ish admin listing, and keeping ciphertext out of it removes any
    chance of a secret being serialized into a config response by accident.
    """

    __tablename__ = "app_secrets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    # Fernet ciphertext — never the raw key
    value_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    # Cached preview so listings never need to decrypt
    masked_preview: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        # Never include the value, not even encrypted
        return f"<AppSecret(name={self.name!r})>"
