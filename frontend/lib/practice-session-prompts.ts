/** Build interview job_description payloads for practice sessions (agent context). */

import type { CodeTopic, EnglishTopic, EnglishTopicListResponse, CodeTopicListResponse, TopicScene } from '@/lib/api/practice_topics';
import { englishTopicsApi, codeTopicsApi } from '@/lib/api/practice_topics';

/** Shown in Admin so editors know how prompts are assembled. */
export const ENGLISH_PRACTICE_PROMPT_HELP =
  'When a user starts English practice, the interview job_description is built from the topic’s scenario prompt plus skill/level metadata. The AI interviewer reads this as the session brief (plus Agent Config → system_prompt).';

export const CODE_PRACTICE_PROMPT_HELP =
  'When a user starts Code practice, the interview job_description is built from the topic’s problem statement plus category/difficulty. The code editor starter template is derived from the problem title. The AI uses hints/rubric from the same payload.';

export const ENGLISH_SESSION_TEMPLATE = `[ENGLISH PRACTICE]
Language: {target_language}
Skill: {skill_focus} | Level: {level}

Scene: {scene.title}          ← only when the learner picked a scene
You play: {scene.ai_role}
The learner plays: {scene.your_role}
Setting: {scene.setting}
Learner's goal: {scene.goal}
Opening line: {scene.opening_line}

{scenario_prompt}

Key vocabulary: …
Evaluation criteria: …`;

export const CODE_SESSION_TEMPLATE = `[CODE PRACTICE]
Category: {category} | Difficulty: {difficulty} | Languages: {languages}

{problem_statement}

Discussion hints (JSON): …
Review rubric (JSON): …`;

async function fetchAllPages<T extends { items: unknown[]; pages: number }>(
  fetchPage: (page: number) => Promise<T>,
): Promise<T['items']> {
  const all: unknown[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const res = await fetchPage(page);
    all.push(...res.items);
    totalPages = res.pages;
    page += 1;
  }
  return all as T['items'];
}

export async function fetchAllEnglishTopicsForAdmin() {
  return fetchAllPages<EnglishTopicListResponse>((page) =>
    englishTopicsApi.list({ page, per_page: 100 }),
  );
}

export async function fetchAllCodeTopicsForAdmin() {
  return fetchAllPages<CodeTopicListResponse>((page) =>
    codeTopicsApi.list({ page, per_page: 100 }),
  );
}

/** Render the chosen scene.
 *
 * Labels must match SCENE_LABELS in src/services/orchestrator/english_practice.py —
 * that parser turns this block back into structured fields for the agent prompt.
 */
function buildSceneBlock(scene: TopicScene): string {
  const lines = [`Scene: ${scene.title}`];
  if (scene.ai_role) lines.push(`You play: ${scene.ai_role}`);
  if (scene.your_role) lines.push(`The learner plays: ${scene.your_role}`);
  if (scene.setting) lines.push(`Setting: ${scene.setting}`);
  if (scene.goal) lines.push(`Learner's goal: ${scene.goal}`);
  if (scene.opening_line) lines.push(`Opening line: ${scene.opening_line}`);
  return lines.join('\n');
}

export function buildEnglishPracticeJobDescription(
  topic: Pick<EnglishTopic, 'skill_focus' | 'level' | 'scenario_prompt' | 'key_vocabulary' | 'evaluation_criteria'>
    & { target_language?: string },
  scene?: TopicScene | null,
): string {
  // The Language line is parsed by parse_session_brief; omitting it means English.
  const language = topic.target_language || 'English';
  return (
    `[ENGLISH PRACTICE]\nLanguage: ${language}\n` +
    `Skill: ${topic.skill_focus} | Level: ${topic.level}\n\n` +
    (scene ? `${buildSceneBlock(scene)}\n\n` : '') +
    `${topic.scenario_prompt}` +
    (topic.key_vocabulary ? `\n\nKey vocabulary: ${topic.key_vocabulary}` : '') +
    (topic.evaluation_criteria ? `\n\nEvaluation criteria: ${topic.evaluation_criteria}` : '')
  );
}

export function buildCodePracticeJobDescription(
  topic: Pick<
    CodeTopic,
    'category' | 'difficulty' | 'languages' | 'problem_statement' | 'discussion_hints' | 'review_rubric' | 'reference_solution'
  >,
): string {
  return (
    `[CODE PRACTICE]\nCategory: ${topic.category} | Difficulty: ${topic.difficulty} | Languages: ${topic.languages}\n\n` +
    `${topic.problem_statement}` +
    (topic.discussion_hints ? `\n\nDiscussion hints (JSON): ${topic.discussion_hints}` : '') +
    (topic.review_rubric ? `\n\nReview rubric (JSON): ${topic.review_rubric}` : '') +
    (topic.reference_solution ? `\n\nReference solution (agent-only): ${topic.reference_solution}` : '')
  );
}
