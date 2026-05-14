"""Add english_topics and code_topics tables

Revision ID: add_practice_topics_001
Revises: add_question_bank_001
Create Date: 2026-05-13 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = 'add_practice_topics_001'
down_revision = 'add_question_bank_001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'english_topics',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('skill_focus', sa.String(50), nullable=False),
        sa.Column('level', sa.String(30), nullable=False),
        sa.Column('scenario_prompt', sa.Text(), nullable=False),
        sa.Column('key_vocabulary', sa.Text(), nullable=True),
        sa.Column('evaluation_criteria', sa.Text(), nullable=True),
        sa.Column('source', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_english_topics_skill_focus', 'english_topics', ['skill_focus'])
    op.create_index('ix_english_topics_level', 'english_topics', ['level'])

    op.create_table(
        'code_topics',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('category', sa.String(100), nullable=False),
        sa.Column('difficulty', sa.String(30), nullable=False),
        sa.Column('languages', sa.String(100), nullable=False, server_default='any'),
        sa.Column('problem_statement', sa.Text(), nullable=False),
        sa.Column('discussion_hints', sa.Text(), nullable=True),
        sa.Column('review_rubric', sa.Text(), nullable=True),
        sa.Column('reference_solution', sa.Text(), nullable=True),
        sa.Column('source', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_code_topics_category', 'code_topics', ['category'])
    op.create_index('ix_code_topics_difficulty', 'code_topics', ['difficulty'])


def downgrade():
    op.drop_index('ix_code_topics_difficulty', 'code_topics')
    op.drop_index('ix_code_topics_category', 'code_topics')
    op.drop_table('code_topics')
    op.drop_index('ix_english_topics_level', 'english_topics')
    op.drop_index('ix_english_topics_skill_focus', 'english_topics')
    op.drop_table('english_topics')
