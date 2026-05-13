"""Add question_bank table with pgvector embeddings

Revision ID: add_question_bank_001
Revises: add_admin_config_001
Create Date: 2026-05-13 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'add_question_bank_001'
down_revision: Union[str, None] = 'add_admin_config_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Enable pgvector extension (idempotent)
    conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))

    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'question_bank' not in tables:
        op.create_table(
            'question_bank',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('category', sa.String(100), nullable=False, index=True),
            sa.Column('subcategory', sa.String(100), nullable=True, index=True),
            sa.Column('level', sa.String(20), nullable=False, index=True),
            sa.Column('topic', sa.String(200), nullable=False),
            sa.Column('question', sa.Text(), nullable=False),
            sa.Column('answer', sa.Text(), nullable=False),
            sa.Column('source', sa.String(500), nullable=True),
            sa.Column('embedding', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    # Convert embedding column to vector(1536) — idempotent (no-op if already vector)
    try:
        conn.execute(sa.text(
            "ALTER TABLE question_bank ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector"
        ))
    except Exception:
        pass  # already vector type


def downgrade() -> None:
    op.drop_table('question_bank')
    op.execute("DROP EXTENSION IF EXISTS vector")
