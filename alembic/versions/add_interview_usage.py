"""Add LLM usage/cost columns to interviews

Revision ID: add_interview_usage_001
Revises: add_language_practice_001
Create Date: 2026-07-21 00:00:00.000000

Accumulated per turn (not per completion) so a session the user paused or left
mid-way still carries the cost it already incurred.

Additive columns with server defaults, so existing rows read as zero. Safely
reversible — downgrade only drops the columns.
"""

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_interview_usage_001'
down_revision: Union[str, None] = 'add_language_practice_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('interviews', sa.Column('llm_calls', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('interviews', sa.Column('llm_prompt_tokens', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('interviews', sa.Column('llm_cached_tokens', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('interviews', sa.Column('llm_completion_tokens', sa.Integer(), nullable=False, server_default='0'))
    # Numeric, not float: money should not accumulate binary rounding error.
    op.add_column('interviews', sa.Column('llm_cost_usd', sa.Numeric(12, 6), nullable=False, server_default='0'))


def downgrade() -> None:
    for col in ('llm_cost_usd', 'llm_completion_tokens', 'llm_cached_tokens',
                'llm_prompt_tokens', 'llm_calls'):
        op.drop_column('interviews', col)
