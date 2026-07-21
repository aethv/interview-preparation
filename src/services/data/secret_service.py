"""Resolve managed secrets: stored value first, environment variable second.

Values are cached in memory so the hot path (every OpenAI client construction)
does not hit the database. Writes invalidate the cache immediately, so an admin
edit takes effect on the next call without a restart.
"""

import logging
import time
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.secrets import (
    SECRET_DEFINITIONS, clear_runtime_cache, decrypt, encrypt, env_fallback,
    get_secret_value, mask, set_runtime_cache,
)
from src.models.app_secret import AppSecret

logger = logging.getLogger(__name__)

_CACHE_TTL = 60.0

# The decrypted values live in src.core.secrets so that vendor client
# constructors can read them without importing the database layer.
_cache_loaded_at: float = 0.0
_loaded_once = False


def invalidate_cache() -> None:
    global _cache_loaded_at, _loaded_once
    clear_runtime_cache()
    _cache_loaded_at = 0.0
    _loaded_once = False


async def load_secrets(db: AsyncSession) -> dict[str, str]:
    """Load and decrypt all stored secrets, refreshing the cache if stale."""
    global _cache_loaded_at, _loaded_once

    now = time.monotonic()
    if _loaded_once and (now - _cache_loaded_at) < _CACHE_TTL:
        return {}

    rows = (await db.execute(select(AppSecret))).scalars().all()

    loaded: dict[str, str] = {}
    for row in rows:
        value = decrypt(row.value_encrypted, name=row.name)
        if value:
            loaded[row.name] = value

    set_runtime_cache(loaded)
    _cache_loaded_at = now
    _loaded_once = True
    return loaded


def get_cached(name: str) -> str:
    """Resolve a secret synchronously: stored value, else environment."""
    return get_secret_value(name)


async def get_secret(db: AsyncSession, name: str) -> str:
    """Resolve a secret, refreshing the cache from the database first."""
    await load_secrets(db)
    return get_cached(name)


async def set_secret(
    db: AsyncSession, name: str, value: str, updated_by: Optional[str] = None
) -> AppSecret:
    """Store (or replace) a secret. The plaintext is never persisted or logged."""
    if name not in SECRET_DEFINITIONS:
        raise ValueError(f"Unknown secret: {name}")

    value = value.strip()
    if not value:
        raise ValueError("Secret value cannot be empty")

    row = (await db.execute(
        select(AppSecret).where(AppSecret.name == name)
    )).scalar_one_or_none()

    if row is None:
        row = AppSecret(name=name)
        db.add(row)

    row.value_encrypted = encrypt(value)
    row.masked_preview = mask(value)
    row.updated_by = updated_by

    await db.commit()
    await db.refresh(row)

    invalidate_cache()
    logger.info("Secret %r updated by %s", name, updated_by or "unknown")
    return row


async def delete_secret(db: AsyncSession, name: str) -> bool:
    """Remove a stored secret so the environment variable applies again."""
    row = (await db.execute(
        select(AppSecret).where(AppSecret.name == name)
    )).scalar_one_or_none()

    if row is None:
        return False

    await db.delete(row)
    await db.commit()

    invalidate_cache()
    logger.info("Secret %r deleted", name)
    return True


async def list_secret_status(db: AsyncSession) -> list[dict]:
    """Describe every managed secret without revealing any value."""
    rows = {
        row.name: row
        for row in (await db.execute(select(AppSecret))).scalars().all()
    }

    status = []
    for name, (label, env_attr) in SECRET_DEFINITIONS.items():
        row = rows.get(name)
        env_value = env_fallback(name)

        if row is not None:
            source = "stored"
            preview = row.masked_preview or "••••"
            updated_at = row.updated_at.isoformat() if row.updated_at else None
        elif env_value:
            source = "environment"
            preview = mask(env_value)
            updated_at = None
        else:
            source = "missing"
            preview = ""
            updated_at = None

        status.append({
            "name": name,
            "label": label,
            "env_var": env_attr,
            "source": source,
            "masked": preview,
            "is_set": source != "missing",
            "updated_at": updated_at,
            "updated_by": row.updated_by if row else None,
        })

    return status
