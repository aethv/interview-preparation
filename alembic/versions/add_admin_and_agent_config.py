"""Add is_admin to users and agent_config table

Revision ID: add_admin_config_001
Revises: add_job_desc_001
Create Date: 2026-05-12 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'add_admin_config_001'
down_revision: Union[str, None] = 'add_job_desc_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # Add is_admin to users
    if 'users' in tables:
        columns = [c['name'] for c in inspector.get_columns('users')]
        if 'is_admin' not in columns:
            op.add_column('users', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'))

    # Create agent_config table
    if 'agent_config' not in tables:
        op.create_table(
            'agent_config',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('key', sa.String(100), nullable=False, unique=True, index=True),
            sa.Column('value', postgresql.JSONB(), nullable=False),
            sa.Column('description', sa.String(500), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    op.drop_table('agent_config')
    op.drop_column('users', 'is_admin')
