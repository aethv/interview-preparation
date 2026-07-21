"""Repair conversation histories duplicated by the old operator.add reducer.

Background
----------
conversation_history used a plain `operator.add` LangGraph reducer. Every turn
re-seeded the graph with the full history loaded from the database, and the
reducer concatenated that snapshot onto the checkpointed value — so the stored
conversation doubled on each execution. Sessions ended up with thousands of
copies of the same handful of messages.

The reducer is fixed (src/services/orchestrator/types.py). This script cleans up
the rows written before the fix.

Safety
------
- Dry run by default: prints what WOULD change and writes nothing.
- Requires --apply to modify data.
- Take a backup first:
      docker compose exec db pg_dump -U interviewlab interviewlab \\
        > backup_pre_dedupe_$(date +%Y%m%d_%H%M).sql

Usage
-----
    python -m scripts.dedupe_conversation_history            # dry run
    python -m scripts.dedupe_conversation_history --apply    # write changes
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Make `src` importable whether this runs from the repo root, from scripts/, or
# piped into the container over stdin (where __file__ does not exist).
try:
    _ROOT = Path(__file__).resolve().parent.parent
except NameError:  # executed via `python - < script`
    _ROOT = Path.cwd()
sys.path.insert(0, str(_ROOT))

from sqlalchemy import select  # noqa: E402

from src.core.database import AsyncSessionLocal  # noqa: E402
from src.models.interview import Interview  # noqa: E402


def dedupe_messages(messages: list[dict]) -> list[dict]:
    """Keep the first occurrence of each (role, content, timestamp).

    Deliberately identical to the merge_messages reducer, so a repaired row is
    exactly what the fixed code would have produced.
    """
    seen = set()
    out = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            out.append(msg)
            continue
        key = (msg.get("role"), msg.get("content"), msg.get("timestamp"))
        if key in seen:
            continue
        seen.add(key)
        out.append(msg)
    return out


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        interviews = (await db.execute(select(Interview))).scalars().all()

        total_removed = 0
        affected = 0

        for interview in interviews:
            history = interview.conversation_history or []
            if not history:
                continue

            cleaned = dedupe_messages(history)
            removed = len(history) - len(cleaned)
            if removed == 0:
                continue

            affected += 1
            total_removed += removed
            print(
                f"  interview {interview.id:>4}  {interview.title[:40]:<42} "
                f"{len(history):>6} -> {len(cleaned):>4}  (-{removed})"
            )

            if apply:
                interview.conversation_history = cleaned
                # turn_count tracks real turns, not stored rows; recompute it
                # from the user messages that survived.
                interview.turn_count = sum(
                    1 for m in cleaned if isinstance(m, dict) and m.get("role") == "user"
                )

        if not affected:
            print("No duplicated histories found. Nothing to do.")
            return

        print(f"\n{affected} interview(s), {total_removed} duplicate message(s)")

        if apply:
            await db.commit()
            print("Changes committed.")
        else:
            print("Dry run — nothing written. Re-run with --apply to fix.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true",
        help="Write the cleaned histories (default is a dry run)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.apply))
