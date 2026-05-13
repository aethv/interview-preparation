"""Admin schemas."""

from typing import Any
from pydantic import BaseModel, Field


class ConfigEntry(BaseModel):
    key: str
    value: Any
    description: str | None = None


class ConfigUpdate(BaseModel):
    value: Any = Field(..., description="New value for this config key")


class AgentConfigResponse(BaseModel):
    key: str
    value: Any
    description: str | None
    updated_at: str

    class Config:
        from_attributes = True


class BulkConfigUpdate(BaseModel):
    configs: list[ConfigEntry]


class UserAdminResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    is_active: bool
    is_admin: bool
    created_at: str

    class Config:
        from_attributes = True


class PromoteUserRequest(BaseModel):
    is_admin: bool
