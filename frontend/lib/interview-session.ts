/** Session mode helpers.
 *
 * session_mode is now a real backend field. The marker sniffing below is only a
 * fallback for interviews created before the session_mode migration, and must
 * stay in sync with src/core/session_modes.py.
 */

export type SessionMode = 'interview' | 'code_practice' | 'language_practice';

/** Value used before multi-language support; still returned by old payloads. */
const LEGACY_LANGUAGE_MODE = 'english_practice';

const CODE_PRACTICE_MARKER = '[CODE PRACTICE]';
const ENGLISH_PRACTICE_MARKER = '[ENGLISH PRACTICE]';

export interface SessionModeSource {
  session_mode?: string | null;
  job_description?: string | null;
  title?: string | null;
}

function inferSessionMode(
  jobDescription: string | null | undefined,
  title: string | null | undefined,
): SessionMode {
  if (jobDescription?.includes(ENGLISH_PRACTICE_MARKER)) return 'language_practice';
  if (title?.toLowerCase().startsWith('english:')) return 'language_practice';
  if (jobDescription?.includes(CODE_PRACTICE_MARKER)) return 'code_practice';
  if (title?.toLowerCase().startsWith('code:')) return 'code_practice';
  return 'interview';
}

export function getSessionMode(source: SessionModeSource | null | undefined): SessionMode {
  const mode = source?.session_mode;
  if (mode === LEGACY_LANGUAGE_MODE) return 'language_practice';
  if (mode === 'interview' || mode === 'code_practice' || mode === 'language_practice') {
    return mode;
  }
  return inferSessionMode(source?.job_description, source?.title);
}

export function isLanguagePracticeInterview(
  jobDescription: string | null | undefined,
  title?: string | null,
  sessionMode?: string | null,
): boolean {
  return getSessionMode({ session_mode: sessionMode, job_description: jobDescription, title })
    === 'language_practice';
}

/** Deprecated alias kept for existing call sites. */
export const isEnglishPracticeInterview = isLanguagePracticeInterview;

export function isCodePracticeInterview(
  jobDescription: string | null | undefined,
  title?: string | null,
  sessionMode?: string | null,
): boolean {
  return getSessionMode({ session_mode: sessionMode, job_description: jobDescription, title })
    === 'code_practice';
}

/** Whether the interview UI should include the code sandbox panel. */
export function showCodeEditor(
  jobDescription: string | null | undefined,
  title?: string | null,
  sessionMode?: string | null,
): boolean {
  return !isLanguagePracticeInterview(jobDescription, title, sessionMode);
}
