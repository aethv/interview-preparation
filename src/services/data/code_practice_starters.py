"""Starter code generation for [CODE PRACTICE] interview sessions."""

from __future__ import annotations

import re

CODE_PRACTICE_MARKER = "[CODE PRACTICE]"


def is_code_practice_interview(
    job_description: str | None,
    title: str | None = None,
) -> bool:
    if job_description and CODE_PRACTICE_MARKER in job_description:
        return True
    return bool(title and title.lower().startswith("code:"))


def parse_code_practice(
    job_description: str | None,
    title: str | None = None,
) -> tuple[str, str]:
    """Return (topic_title, problem_statement)."""
    topic_title = "Coding Exercise"
    if title:
        topic_title = re.sub(r"^code:\s*", "", title, flags=re.IGNORECASE).strip() or topic_title

    if not job_description or CODE_PRACTICE_MARKER not in job_description:
        return topic_title, ""

    after_marker = job_description.split(CODE_PRACTICE_MARKER, 1)[1]
    lines = after_marker.strip().split("\n")
    problem_text = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
    problem_statement = re.split(
        r"\n\n(?:Discussion hints|Review rubric|Reference solution)",
        problem_text,
        maxsplit=1,
    )[0].strip()
    return topic_title, problem_statement


def title_to_camel_case(title: str) -> str:
    words = re.sub(r"[^a-zA-Z0-9\s]", " ", title).split()
    words = [w for w in words if w]
    if not words:
        return "solve"
    return words[0].lower() + "".join(w.capitalize() for w in words[1:])


def get_starter_code(title: str, problem_statement: str, language: str = "python") -> str:
    fn = title_to_camel_case(title)
    hint = ""
    for line in problem_statement.split("\n"):
        if line.strip():
            hint = line.strip()[:120]
            break

    starters = {
        "python": f'''class Solution:
    def {fn}(self, nums: list[int]) -> None:
        """
        {title}
        {hint}
        Modify nums in-place. Do not return anything.
        """
        pass


# Example
nums = [0, 1, 0, 3, 12]
Solution().{fn}(nums)
print(nums)''',
        "javascript": f'''/**
 * {title}
 * {hint}
 * @param {{number[]}} nums
 * @return {{void}} Do not return anything, modify nums in-place.
 */
function {fn}(nums) {{
    // TODO: implement
}}

const nums = [0, 1, 0, 3, 12];
{fn}(nums);
console.log(nums);''',
        "java": f'''class Solution {{
    /**
     * {title}
     * {hint}
     */
    public void {fn}(int[] nums) {{
        // TODO: implement in-place
    }}

    public static void main(String[] args) {{
        int[] nums = {{0, 1, 0, 3, 12}};
        new Solution().{fn}(nums);
        System.out.println(java.util.Arrays.toString(nums));
    }}
}}''',
    }
    return starters.get(language, starters["python"])


def build_sandbox_seed(
    job_description: str | None,
    title: str | None,
) -> dict | None:
    """Build sandbox state to store in resume_context for code practice sessions."""
    if not is_code_practice_interview(job_description, title):
        return None

    topic_title, problem_statement = parse_code_practice(job_description, title)
    return {
        "is_active": True,
        "initial_code": get_starter_code(topic_title, problem_statement, "python"),
        "exercise_description": problem_statement,
        "exercise_difficulty": "medium",
        "exercise_hints": [],
        "last_code_snapshot": "",
        "last_poll_time": 0.0,
        "last_activity_ts": 0.0,
        "submissions": [],
        "signals": [],
    }
