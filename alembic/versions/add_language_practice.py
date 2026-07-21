"""Generalize English practice to any target language

Revision ID: add_language_practice_001
Revises: add_app_secrets_001
Create Date: 2026-07-21 00:00:00.000000

Two changes:

1. english_topics gains target_language (default 'English'). Existing rows are
   English topics, so the default backfills them correctly.
2. interviews.session_mode 'english_practice' becomes 'language_practice'. The
   mode was never about English specifically — it means "spoken conversation
   practice, no code sandbox" — and keeping the old name would mislead every
   future reader once Japanese topics exist.

The application still accepts 'english_practice' on input (see
src/core/session_modes.py) so older clients and bookmarked payloads keep working.

BACKUP BEFORE RUNNING:
    docker compose exec db pg_dump -U interviewlab interviewlab > backup_pre_language.sql
"""

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_language_practice_001'
down_revision: Union[str, None] = 'add_app_secrets_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'english_topics',
        sa.Column('target_language', sa.String(50), nullable=False,
                  server_default='English'),
    )
    op.create_index('ix_english_topics_target_language',
                    'english_topics', ['target_language'])

    # The check constraint pins the allowed values, so it has to be replaced
    # before the data can be renamed.
    op.drop_constraint('ck_interviews_session_mode', 'interviews', type_='check')
    op.execute(
        "UPDATE interviews SET session_mode = 'language_practice' "
        "WHERE session_mode = 'english_practice'"
    )
    op.create_check_constraint(
        'ck_interviews_session_mode',
        'interviews',
        "session_mode IN ('interview', 'code_practice', 'language_practice')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_interviews_session_mode', 'interviews', type_='check')
    op.execute(
        "UPDATE interviews SET session_mode = 'english_practice' "
        "WHERE session_mode = 'language_practice'"
    )
    op.create_check_constraint(
        'ck_interviews_session_mode',
        'interviews',
        "session_mode IN ('interview', 'code_practice', 'english_practice')",
    )

    op.drop_index('ix_english_topics_target_language', table_name='english_topics')
    op.drop_column('english_topics', 'target_language')
