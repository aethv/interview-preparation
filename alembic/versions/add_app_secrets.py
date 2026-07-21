"""Add app_secrets table

Revision ID: add_app_secrets_001
Revises: add_topic_scenes_001
Create Date: 2026-07-21 00:00:00.000000

Stores third-party API keys as Fernet ciphertext so they can be managed from the
admin UI without a redeploy. No data is migrated: until an admin saves a key,
every consumer keeps using the environment variable.

BACKUP BEFORE RUNNING (new table only, nothing existing is touched):
    pg_dump "$DATABASE_URL" > backup_pre_app_secrets.sql
"""

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_app_secrets_001'
down_revision: Union[str, None] = 'add_topic_scenes_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'app_secrets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('value_encrypted', sa.Text(), nullable=False),
        sa.Column('masked_preview', sa.String(100), nullable=False, server_default=''),
        sa.Column('updated_by', sa.String(255), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_app_secrets_name', 'app_secrets', ['name'], unique=True)


def downgrade() -> None:
    # Drops stored keys. They remain available via environment variables.
    op.drop_index('ix_app_secrets_name', table_name='app_secrets')
    op.drop_table('app_secrets')
