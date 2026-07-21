"""Add scenes to english_topics

Revision ID: add_topic_scenes_001
Revises: add_session_mode_001
Create Date: 2026-07-21 00:00:00.000000

Each English topic can offer 2-4 concrete scenes the learner picks between
before starting (role, setting, goal, opening line).

Nullable with no backfill: topics without scenes keep working and simply start
straight from scenario_prompt, so this is additive and safely reversible.

BACKUP BEFORE RUNNING:
    pg_dump -t english_topics "$DATABASE_URL" > english_topics_pre_scenes.sql
"""

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'add_topic_scenes_001'
down_revision: Union[str, None] = 'add_session_mode_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'english_topics',
        sa.Column('scenes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    # Drops the scene definitions. Restore from the pg_dump above if needed.
    op.drop_column('english_topics', 'scenes')
