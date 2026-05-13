"""Admin endpoints — agent config management and user administration."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.core.database import get_db
from src.models.user import User
from src.models.agent_config import AgentConfig
from src.api.v1.dependencies import get_current_user
from src.schemas.admin import (
    AgentConfigResponse,
    ConfigUpdate,
    BulkConfigUpdate,
    UserAdminResponse,
    PromoteUserRequest,
)
from src.services.orchestrator.config_service import AgentConfigService

router = APIRouter()


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


# ── Model discovery endpoint ──────────────────────────────────────────────────

_CHAT_EXCLUDE = frozenset([
    'audio', 'realtime', 'transcribe', 'tts', 'search', 'instruct',
    'whisper', 'dall-e', 'embedding', 'davinci', 'babbage', 'ada',
    'moderation', 'codex', 'image',
])

_CHAT_PREFIXES = ('gpt-', 'o1', 'o3', 'o4', 'chatgpt-')


@router.get("/models")
async def list_models(
    vendor: str = Query(default="openai"),
    _: User = Depends(require_admin),
):
    """Return available chat-completion models for the given vendor."""
    if vendor != "openai":
        raise HTTPException(status_code=400, detail=f"Vendor '{vendor}' not supported")

    try:
        from openai import AsyncOpenAI
        from src.core.config import settings
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        response = await client.models.list()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch models: {exc}")

    models = []
    for m in response.data:
        mid = m.id.lower()
        if not any(mid.startswith(p) for p in _CHAT_PREFIXES):
            continue
        if any(pat in mid for pat in _CHAT_EXCLUDE):
            continue
        models.append(m.id)

    return {"vendor": vendor, "models": sorted(models)}


# ── Config endpoints ──────────────────────────────────────────────────────────

@router.get("/config", response_model=list[AgentConfigResponse])
async def get_all_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Return all agent config entries, seeding defaults on first call."""
    # load() seeds missing defaults into DB automatically
    await AgentConfigService.load(db)
    result = await db.execute(select(AgentConfig).order_by(AgentConfig.key))
    rows = result.scalars().all()
    return [
        AgentConfigResponse(
            key=r.key,
            value=r.value,
            description=r.description,
            updated_at=r.updated_at.isoformat(),
        )
        for r in rows
    ]


@router.put("/config/{key}", response_model=AgentConfigResponse)
async def update_config(
    key: str,
    body: ConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update a single config entry."""
    result = await db.execute(select(AgentConfig).where(AgentConfig.key == key))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail=f"Config key '{key}' not found")
    row.value = body.value
    await db.commit()
    await db.refresh(row)
    # Invalidate in-memory cache
    AgentConfigService.invalidate_cache()
    return AgentConfigResponse(
        key=row.key, value=row.value, description=row.description,
        updated_at=row.updated_at.isoformat(),
    )


@router.post("/config/bulk", response_model=list[AgentConfigResponse])
async def bulk_update_config(
    body: BulkConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update multiple config entries at once."""
    updated = []
    for entry in body.configs:
        result = await db.execute(select(AgentConfig).where(AgentConfig.key == entry.key))
        row = result.scalar_one_or_none()
        if row:
            row.value = entry.value
            if entry.description is not None:
                row.description = entry.description
        else:
            row = AgentConfig(key=entry.key, value=entry.value, description=entry.description)
            db.add(row)
        updated.append(row)
    await db.commit()
    for row in updated:
        await db.refresh(row)
    AgentConfigService.invalidate_cache()
    return [
        AgentConfigResponse(
            key=r.key, value=r.value, description=r.description,
            updated_at=r.updated_at.isoformat(),
        )
        for r in updated
    ]


@router.post("/config/reset", response_model=list[AgentConfigResponse])
async def reset_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Reset all config to defaults."""
    defaults = AgentConfigService.get_defaults()
    updated = []
    for key, (value, description) in defaults.items():
        result = await db.execute(select(AgentConfig).where(AgentConfig.key == key))
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            row = AgentConfig(key=key, value=value, description=description)
            db.add(row)
        updated.append(row)
    await db.commit()
    for row in updated:
        await db.refresh(row)
    AgentConfigService.invalidate_cache()
    return [
        AgentConfigResponse(
            key=r.key, value=r.value, description=r.description,
            updated_at=r.updated_at.isoformat(),
        )
        for r in updated
    ]


# ── User management endpoints ─────────────────────────────────────────────────

@router.get("/users", response_model=list[UserAdminResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """List all users."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [
        UserAdminResponse(
            id=u.id, email=u.email, full_name=u.full_name,
            is_active=u.is_active, is_admin=u.is_admin,
            created_at=u.created_at.isoformat(),
        )
        for u in users
    ]


@router.patch("/users/{user_id}", response_model=UserAdminResponse)
async def update_user_admin(
    user_id: int,
    body: PromoteUserRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Grant or revoke admin privileges for a user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot change your own admin status")
    user.is_admin = body.is_admin
    await db.commit()
    await db.refresh(user)
    return UserAdminResponse(
        id=user.id, email=user.email, full_name=user.full_name,
        is_active=user.is_active, is_admin=user.is_admin,
        created_at=user.created_at.isoformat(),
    )
