"""Add session_mode to interviews

Revision ID: add_session_mode_001
Revises: add_practice_topics_001
Create Date: 2026-07-21 00:00:00.000000

Makes the session type a first-class column instead of sniffing the
"[ENGLISH PRACTICE]" / "[CODE PRACTICE]" markers out of title/job_description.

Backfill is derived from those markers, so this migration is reversible without
data loss: downgrade only drops the column, the markers stay in job_description.

BACKUP BEFORE RUNNING:
    pg_dump -t interviews "$DATABASE_URL" > interviews_pre_session_mode.sql
"""

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_session_mode_001'
down_revision: Union[str, None] = 'add_practice_topics_001'
branch_labels = None
depends_on = None


SESSION_MODES = ('interview', 'code_practice', 'english_practice')


def upgrade() -> None:
    # server_default keeps existing rows valid while the column is created NOT NULL
    op.add_column(
        'interviews',
        sa.Column(
            'session_mode',
            sa.String(30),
            nullable=False,
            server_default='interview',
        ),
    )
    op.create_index('ix_interviews_session_mode',
                    'interviews', ['session_mode'])

    # Backfill from the legacy markers. Title check mirrors the frontend
    # heuristic in lib/interview-session.ts so nothing changes classification.
    # strpos/left instead of LIKE: avoids '%' in the statement, which some
    # drivers treat as a parameter placeholder escape.
    op.execute(
        """
        UPDATE interviews
        SET session_mode = 'english_practice'
        WHERE strpos(coalesce(job_description, ''), '[ENGLISH PRACTICE]') > 0
           OR left(lower(title), 8) = 'english:'
        """
    )
    op.execute(
        """
        UPDATE interviews
        SET session_mode = 'code_practice'
        WHERE session_mode = 'interview'
          AND (strpos(coalesce(job_description, ''), '[CODE PRACTICE]') > 0
               OR left(lower(title), 5) = 'code:')
        """
    )

    allowed = ", ".join(f"'{mode}'" for mode in SESSION_MODES)
    op.create_check_constraint(
        'ck_interviews_session_mode',
        'interviews',
        f"session_mode IN ({allowed})",
    )


def downgrade() -> None:
    op.drop_constraint('ck_interviews_session_mode',
                       'interviews', type_='check')
    op.drop_index('ix_interviews_session_mode', table_name='interviews')
    op.drop_column('interviews', 'session_mode')
