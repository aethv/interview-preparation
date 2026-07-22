import { apiClient } from './client';

import type { SessionMode } from '@/lib/interview-session';

/** One entry in an interview transcript. */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  /** Node-attached extras, e.g. { type: 'english_turn', correction: {...} }. */
  metadata?: Record<string, unknown>;
}

/**
 * Stored feedback. The shape differs by session mode — interview sessions carry
 * the four skill scores, English sessions carry language scores — so only the
 * keys every consumer relies on are typed.
 */
export interface InterviewFeedback {
  type?: string;
  summary?: string;
  overall_score?: number;
  topics_covered?: string[];
  [key: string]: unknown;
}

export interface Interview {
  id: number;
  user_id: number;
  resume_id: number | null;
  title: string;
  status: string;
  /** interview | code_practice | language_practice — authoritative from the backend. */
  session_mode?: SessionMode;
  conversation_history: ConversationMessage[] | null;
  resume_context: Record<string, unknown> | null;
  job_description: string | null;
  feedback: InterviewFeedback | null;
  turn_count: number;
  /** Accumulated LLM usage (chat only; excludes speech). Approximate. */
  llm_calls?: number;
  llm_total_tokens?: number;
  llm_cost_usd?: number;
  current_message: string | null;
  sandbox: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Live panel state for a language practice session (computed, no LLM calls). */
export interface EnglishSessionState {
  session_mode: string;
  /** Language being practised — drives the panel copy. */
  target_language: string;
  phase: string;
  phase_hint: string;
  skill_focus: string;
  level: string;
  scene: {
    title: string;
    your_role: string;
    ai_role: string;
    setting: string;
    goal: string;
  } | null;
  objective: string;
  vocabulary: { word: string; used: boolean }[];
  vocabulary_used_count: number;
  corrections: { said: string; better: string; why?: string; at?: string }[];
  /** Turns where the learner fell back to their first language. */
  language_switches: { said: string; english_version: string; at?: string }[];
  /** Consecutive learner turns kept in English. */
  english_only_streak: number;
  turn_count: number;
  learner_turns: number;
  status: string;
}

/** The four skills scored for interview-style sessions. */
export type SkillName = 'communication' | 'technical' | 'problem_solving' | 'code_quality';

export const SKILL_NAMES: SkillName[] = [
  'communication', 'technical', 'problem_solving', 'code_quality',
];

export interface SkillDetail {
  score: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

/** GET /interviews/{id}/skills — the breakdown is nested in an envelope. */
export interface InterviewSkillBreakdown {
  interview_id: number;
  interview_title: string;
  completed_at: string | null;
  skill_breakdown: Record<string, SkillDetail>;
}

export interface SkillProgressionPoint {
  interview_id: number;
  interview_title: string;
  date: string;
  score: number;
}

/** GET .../skills/progression — one series per skill. */
export type SkillProgression = Record<SkillName, SkillProgressionPoint[]>;

/** GET .../skills/averages — a flat score per skill. */
export type SkillAverages = Record<SkillName, number>;

/** GET .../skills/compare — comparison maps skill -> { interviewId: score }. */
export interface SkillComparisonResponse {
  comparison: Record<SkillName, Record<string, number>>;
  interviews: Array<{
    id: number;
    title: string;
    completed_at: string | null;
  }>;
}

export const interviewsApi = {
  list: (): Promise<Interview[]> =>
    apiClient.get('/api/v1/interviews'),

  get: (id: number): Promise<Interview> =>
    apiClient.get(`/api/v1/interviews/${id}`),

  create: (data: {
    title: string;
    resume_id?: number;
    job_description?: string;
    session_mode?: SessionMode;
  }): Promise<Interview> =>
    apiClient.post('/api/v1/interviews', data),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/api/v1/interviews/${id}`),

  start: (id: number): Promise<Interview> =>
    apiClient.post('/api/v1/interviews/start', { interview_id: id }),

  complete: (id: number): Promise<Interview> =>
    apiClient.post('/api/v1/interviews/complete', { interview_id: id }),

  submitCode: (id: number, code: string, language: string): Promise<Interview> =>
    apiClient.post('/api/v1/interviews/submit-code', { interview_id: id, code, language }),

  updateSandboxCode: (id: number, code: string): Promise<{ status: string; has_guidance: boolean }> =>
    apiClient.put(`/api/v1/interviews/${id}/sandbox/code`, { code }),

  getSessionState: (id: number): Promise<EnglishSessionState> =>
    apiClient.get(`/api/v1/interviews/${id}/session-state`),

  getInterviewSkills: (id: number): Promise<InterviewSkillBreakdown> =>
    apiClient.get(`/api/v1/interviews/${id}/skills`),

  getSkillProgression: (): Promise<SkillProgression> =>
    apiClient.get('/api/v1/interviews/analytics/skills/progression'),

  getSkillAverages: (): Promise<SkillAverages> =>
    apiClient.get('/api/v1/interviews/analytics/skills/averages'),

  compareSkillInterviews: (ids: number[]): Promise<SkillComparisonResponse> =>
    apiClient.get(`/api/v1/interviews/analytics/skills/compare?interview_ids=${ids.join(',')}`),
};
