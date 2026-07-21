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

    # Convert embedding column to vector(1536) — skipped if already converted.
    #
    # This must NOT be a bare try/except around the ALTER: catching the Python
    # exception does not clear the aborted Postgres transaction, so every later
    # statement (including alembic's own UPDATE alembic_version) then fails with
    # InFailedSQLTransactionError. Check the current type instead, and isolate
    # the ALTER in a SAVEPOINT so a failure cannot poison the outer transaction.
    current_type = conn.execute(sa.text(
        """
        SELECT udt_name
        FROM information_schema.columns
        WHERE table_name = 'question_bank' AND column_name = 'embedding'
        """
    )).scalar()

    if current_type is None:
        # The column is absent when the table was created by
        # Base.metadata.create_all: the ORM model deliberately does not map
        # `embedding`, so create_all builds the table without it and every
        # similarity search then fails.
        op.execute("ALTER TABLE question_bank ADD COLUMN embedding vector(1536)")
    elif current_type != 'vector':
        with conn.begin_nested():
            conn.execute(sa.text(
                "ALTER TABLE question_bank "
                "ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector"
            ))


def downgrade() -> None:
    op.drop_table('question_bank')
    op.execute("DROP EXTENSION IF EXISTS vector")
