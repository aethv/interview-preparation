/** Starter templates and parsing for [CODE PRACTICE] interview sessions. */

import { isCodePracticeInterview } from '@/lib/interview-session';

export interface CodePracticeContext {
  title: string;
  problemStatement: string;
}

const CODE_PRACTICE_MARKER = '[CODE PRACTICE]';

export { isCodePracticeInterview };

export function parseCodePractice(
  jobDescription: string | null | undefined,
  title?: string | null,
): CodePracticeContext {
  const topicTitle =
    title?.replace(/^code:\s*/i, '').trim() ||
    'Coding Exercise';

  if (!jobDescription?.includes(CODE_PRACTICE_MARKER)) {
    return { title: topicTitle, problemStatement: '' };
  }

  const afterMarker = jobDescription.split(CODE_PRACTICE_MARKER)[1] ?? '';
  const lines = afterMarker.trim().split('\n');
  // Skip metadata line: "Category: ... | Difficulty: ..."
  const problemLines = lines.slice(1).join('\n').trim();
  const problemStatement = problemLines.split(/\n\n(?:Discussion hints|Review rubric|Reference solution)/)[0].trim();

  return { title: topicTitle, problemStatement };
}

export function titleToCamelCase(title: string): string {
  const words = title.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'solve';
  return (
    words[0].toLowerCase() +
    words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
  );
}

function firstProblemLine(problemStatement: string): string {
  const line = problemStatement.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.slice(0, 120);
}

export function getCodePracticeStarters(
  title: string,
  problemStatement: string,
): Record<string, string> {
  const fn = titleToCamelCase(title);
  const hint = firstProblemLine(problemStatement);

  return {
    python: `class Solution:
    def ${fn}(self, nums: list[int]) -> None:
        """
        ${title}
        ${hint}
        Modify nums in-place. Do not return anything.
        """
        pass


# Example
nums = [0, 1, 0, 3, 12]
Solution().${fn}(nums)
print(nums)`,
    javascript: `/**
 * ${title}
 * ${hint}
 * @param {number[]} nums
 * @return {void} Do not return anything, modify nums in-place.
 */
function ${fn}(nums) {
    // TODO: implement
}

const nums = [0, 1, 0, 3, 12];
${fn}(nums);
console.log(nums);`,
    java: `class Solution {
    /**
     * ${title}
     * ${hint}
     */
    public void ${fn}(int[] nums) {
        // TODO: implement in-place
    }

    public static void main(String[] args) {
        int[] nums = {0, 1, 0, 3, 12};
        new Solution().${fn}(nums);
        System.out.println(java.util.Arrays.toString(nums));
    }
}`,
  };
}

/** Default sandbox template for non–code-practice technical interviews. */
export function getDefaultStarters(): Record<string, string> {
  return {
    python: `def fibonacci(n):
    """Calculate the nth Fibonacci number."""
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

# Test the function
print(fibonacci(10))`,
    javascript: `function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

// Test the function
console.log(fibonacci(10));`,
    java: `public class Solution {
    public static int fibonacci(int n) {
        if (n <= 1) return n;
        int a = 0, b = 1;
        for (int i = 2; i <= n; i++) {
            int tmp = a + b;
            a = b;
            b = tmp;
        }
        return b;
    }

    public static void main(String[] args) {
        System.out.println(fibonacci(10));
    }
}`,
  };
}

export function resolveInitialCode(
  interview: {
    title: string;
    job_description?: string | null;
    sandbox?: Record<string, unknown> | null;
  },
  language: string,
): { code: string; description: string | null; starters: Record<string, string> } {
  const sandboxInitial = typeof interview.sandbox?.initial_code === 'string'
    ? interview.sandbox.initial_code.trim()
    : '';
  const sandboxDescription = typeof interview.sandbox?.exercise_description === 'string'
    ? interview.sandbox.exercise_description
    : null;

  if (isCodePracticeInterview(interview.job_description, interview.title)) {
    const parsed = parseCodePractice(interview.job_description, interview.title);
    const starters = getCodePracticeStarters(parsed.title, parsed.problemStatement);
    const code = sandboxInitial || starters[language] || starters.python;
    return {
      code,
      description: sandboxDescription || parsed.problemStatement || null,
      starters,
    };
  }

  const starters = getDefaultStarters();
  return {
    code: sandboxInitial || starters[language] || starters.python,
    description: sandboxDescription,
    starters,
  };
}
