import { apiClient } from './client';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

// ── English Topics ─────────────────────────────────────────────────────────────

/** One pickable variation of a topic's scenario. */
export interface TopicScene {
  id: string;
  title: string;
  your_role: string;
  ai_role: string;
  setting: string;
  goal: string;
  opening_line: string;
}

export const EMPTY_SCENE: Omit<TopicScene, 'id'> = {
  title: '', your_role: '', ai_role: '', setting: '', goal: '', opening_line: '',
};

export interface EnglishTopic {
  id: number;
  title: string;
  /** Language being practised. Older topics default to English. */
  target_language: string;
  skill_focus: string;
  level: string;
  scenario_prompt: string;
  /** Empty when the topic has no scenes — the session then starts from scenario_prompt. */
  scenes: TopicScene[];
  key_vocabulary: string | null;
  evaluation_criteria: string | null;
  source: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EnglishTopicListResponse {
  items: EnglishTopic[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface EnglishTopicPreview {
  title: string;
  target_language?: string;
  skill_focus: string;
  level: string;
  scenario_prompt: string;
  key_vocabulary: string | null;
  evaluation_criteria: string | null;
  source: string | null;
}

export interface EnglishTopicMeta {
  skill_focus_options: string[];
  level_options: string[];
  language_options?: string[];
}

function discoverStream(
  endpoint: string,
  url: string,
  humanFeedback?: string,
  cookies?: string,
  onLog?: (msg: string) => void,
  onPlan?: (steps: BrowserPlanStep[], reasoning: string) => void,
  onStep?: (index: number, status: BrowserStepStatus['status'], description: string, error?: string, screenshot_b64?: string) => void,
  onSession?: (sessionId: string) => void,
  onNeedsHuman?: (event: NeedsHumanEvent) => void,
  onResuming?: () => void,
  onScreenshot?: (screenshot_b64: string) => void,
): Promise<PageDiscovery> {
  const token = getToken();
  return new Promise(async (resolve, reject) => {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url, instructions: humanFeedback, cookies: cookies || undefined }),
      });
    } catch {
      return reject(new Error('Network error'));
    }
    if (!response.ok) return reject(new Error(`Server error: ${response.status}`));

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let evt: any;
          try { evt = JSON.parse(part.slice(6)); } catch { continue; }
          if (evt.type === 'log') onLog?.(evt.message ?? '');
          else if (evt.type === 'plan') onPlan?.(evt.steps ?? [], evt.reasoning ?? '');
          else if (evt.type === 'step') { onStep?.(evt.index, evt.status, evt.description, evt.error, evt.screenshot_b64); if (evt.screenshot_b64) onScreenshot?.(evt.screenshot_b64); }
          else if (evt.type === 'screenshot') onScreenshot?.(evt.screenshot_b64);
          else if (evt.type === 'session') onSession?.(evt.session_id);
          else if (evt.type === 'needs_human') onNeedsHuman?.(evt as NeedsHumanEvent);
          else if (evt.type === 'resuming') onResuming?.();
          else if (evt.type === 'discovered') { resolve({ ...(evt.data as PageDiscovery), form_data: evt.data?.form_data ?? null }); return; }
          else if (evt.type === 'error') { reject(new Error(evt.message)); return; }
        }
      }
      reject(new Error('Stream ended without result'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Stream read error'));
    }
  });
}

async function sendDiscoverFeedback(feedbackEndpoint: string, sessionId: string, instruction: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE_URL}${feedbackEndpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ session_id: sessionId, instruction }),
  });
  if (!response.ok) throw new Error(`Feedback failed: ${response.status}`);
}

function sseStream<T>(
  endpoint: string,
  body: object,
  onLog?: (msg: string) => void,
): Promise<T[]> {
  const token = getToken();
  return new Promise(async (resolve, reject) => {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      return reject(new Error('Network error'));
    }
    if (!response.ok) return reject(new Error(`Server error: ${response.status}`));

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          let evt: { type: string; message?: string; data?: T[] };
          try { evt = JSON.parse(part.slice(6)); } catch { continue; }
          if (evt.type === 'log') onLog?.(evt.message ?? '');
          else if (evt.type === 'result') { resolve(evt.data ?? []); return; }
          else if (evt.type === 'error') { reject(new Error(evt.message)); return; }
        }
      }
      reject(new Error('Stream ended without result'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Stream read error'));
    }
  });
}

function fileUploadStream<T>(
  endpoint: string,
  file: File,
  instructions?: string,
  onProgress?: (p: number) => void,
): Promise<T[]> {
  const form = new FormData();
  form.append('file', file);
  if (instructions) form.append('instructions', instructions);
  const token = getToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}${endpoint}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve([] as T[]); }
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).detail || xhr.statusText)); } catch { reject(new Error(xhr.statusText)); }
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

export interface DiscoveredItem {
  title: string;
  identifier?: string | null;
  difficulty?: string | null;
  note?: string | null;
  url?: string | null;  // direct link to the individual problem page
}

export interface PageDiscovery {
  page_type: 'list' | 'single' | 'unknown';
  page_title: string;
  description: string;
  items: DiscoveredItem[];
  total_count: number;
  screenshot_b64?: string | null;
  /** Pre-extracted form fields from inline extraction — present when page_type==='single' */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form_data?: any[] | null;
}

export interface BrowserPlanStep {
  action: string;
  target?: string | null;
  description: string;
  success_criteria: string;
  fail_criteria: string;
  optional: boolean;
}

export interface BrowserStepStatus extends BrowserPlanStep {
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  error?: string;
  screenshot_b64?: string;
}

export interface NeedsHumanEvent {
  session_id: string;
  screenshot_b64: string;
  message: string;
  gpt_suggestion: string;
}

export interface EnglishAIFillResponse {
  scenario_prompt: string;
  key_vocabulary: string | null;
  evaluation_criteria: string | null;
}

export interface CodeAIFillResponse {
  problem_statement: string;
  discussion_hints: string | null;
  review_rubric: string | null;
  reference_solution: string | null;
}

export const englishTopicsApi = {
  getMeta: (): Promise<EnglishTopicMeta> =>
    apiClient.get('/api/v1/admin/english-topics/meta'),

  list: (params: {
    skill_focus?: string;
    level?: string;
    search?: string;
    target_language?: string;
    page?: number;
    per_page?: number;
  }): Promise<EnglishTopicListResponse> => {
    const q = new URLSearchParams();
    if (params.skill_focus) q.set('skill_focus', params.skill_focus);
    if (params.level) q.set('level', params.level);
    if (params.search) q.set('search', params.search);
    if (params.target_language) q.set('target_language', params.target_language);
    if (params.page) q.set('page', String(params.page));
    if (params.per_page) q.set('per_page', String(params.per_page));
    return apiClient.get(`/api/v1/admin/english-topics?${q.toString()}`);
  },

  create: (body: Omit<EnglishTopic, 'id' | 'created_at' | 'updated_at'>): Promise<EnglishTopic> =>
    apiClient.post('/api/v1/admin/english-topics', body),

  update: (id: number, body: Partial<Omit<EnglishTopic, 'id' | 'created_at' | 'updated_at'>>): Promise<EnglishTopic> =>
    apiClient.put(`/api/v1/admin/english-topics/${id}`, body),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/api/v1/admin/english-topics/${id}`),

  extractFromUrlStream: (
    url: string,
    instructions?: string,
    itemUrls?: string[],
    onLog?: (msg: string) => void,
  ): Promise<EnglishTopicPreview[]> =>
    sseStream<EnglishTopicPreview>(
      '/api/v1/admin/english-topics/import/extract-url/stream',
      { url, instructions, item_urls: itemUrls?.length ? itemUrls : undefined },
      onLog,
    ),

  extractFromFile: (
    file: File,
    instructions?: string,
    onProgress?: (p: number) => void,
  ): Promise<EnglishTopicPreview[]> =>
    fileUploadStream<EnglishTopicPreview>(
      '/api/v1/admin/english-topics/import/extract-file',
      file,
      instructions,
      onProgress,
    ),

  confirmImport: (topics: EnglishTopicPreview[]): Promise<{ imported: number; skipped: number }> =>
    apiClient.post('/api/v1/admin/english-topics/import/confirm', { topics }),

  aiFill: (title: string, skill_focus: string, level: string): Promise<EnglishAIFillResponse> =>
    apiClient.post('/api/v1/admin/english-topics/ai-fill', { title, skill_focus, level }),

  aiFillFromImage: (image_b64: string): Promise<EnglishAIFillResponse & { title?: string; skill_focus?: string; level?: string }> =>
    apiClient.post('/api/v1/admin/english-topics/ai-fill-image', { image_b64 }),

  discoverStream: (
    url: string,
    humanFeedback?: string,
    cookies?: string,
    onLog?: (msg: string) => void,
    onPlan?: (steps: BrowserPlanStep[], reasoning: string) => void,
    onStep?: (index: number, status: BrowserStepStatus['status'], description: string, error?: string, screenshot_b64?: string) => void,
    onSession?: (sessionId: string) => void,
    onNeedsHuman?: (event: NeedsHumanEvent) => void,
    onResuming?: () => void,
    onScreenshot?: (screenshot_b64: string) => void,
  ): Promise<PageDiscovery> =>
    discoverStream('/api/v1/admin/english-topics/import/discover/stream', url, humanFeedback, cookies, onLog, onPlan, onStep, onSession, onNeedsHuman, onResuming, onScreenshot),

  sendDiscoverFeedback: (sessionId: string, instruction: string): Promise<void> =>
    sendDiscoverFeedback('/api/v1/admin/english-topics/import/discover/feedback', sessionId, instruction),
};

// ── Code Topics ────────────────────────────────────────────────────────────────

export interface CodeTopic {
  id: number;
  title: string;
  category: string;
  difficulty: string;
  languages: string;
  problem_statement: string;
  discussion_hints: string | null;
  review_rubric: string | null;
  reference_solution: string | null;
  source: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CodeTopicListResponse {
  items: CodeTopic[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface CodeTopicPreview {
  title: string;
  category: string;
  difficulty: string;
  languages: string;
  problem_statement: string;
  discussion_hints: string | null;
  review_rubric: string | null;
  reference_solution: string | null;
  source: string | null;
}

export interface CodeTopicMeta {
  categories: string[];
  difficulties: string[];
  languages: string[];
}

export const codeTopicsApi = {
  getMeta: (): Promise<CodeTopicMeta> =>
    apiClient.get('/api/v1/admin/code-topics/meta'),

  list: (params: {
    category?: string;
    difficulty?: string;
    search?: string;
    page?: number;
    per_page?: number;
  }): Promise<CodeTopicListResponse> => {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.difficulty) q.set('difficulty', params.difficulty);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.per_page) q.set('per_page', String(params.per_page));
    return apiClient.get(`/api/v1/admin/code-topics?${q.toString()}`);
  },

  create: (body: Omit<CodeTopic, 'id' | 'created_at' | 'updated_at'>): Promise<CodeTopic> =>
    apiClient.post('/api/v1/admin/code-topics', body),

  update: (id: number, body: Partial<Omit<CodeTopic, 'id' | 'created_at' | 'updated_at'>>): Promise<CodeTopic> =>
    apiClient.put(`/api/v1/admin/code-topics/${id}`, body),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/api/v1/admin/code-topics/${id}`),

  extractFromUrlStream: (
    url: string,
    instructions?: string,
    itemUrls?: string[],
    onLog?: (msg: string) => void,
  ): Promise<CodeTopicPreview[]> =>
    sseStream<CodeTopicPreview>(
      '/api/v1/admin/code-topics/import/extract-url/stream',
      { url, instructions, item_urls: itemUrls?.length ? itemUrls : undefined },
      onLog,
    ),

  extractFromFile: (
    file: File,
    instructions?: string,
    onProgress?: (p: number) => void,
  ): Promise<CodeTopicPreview[]> =>
    fileUploadStream<CodeTopicPreview>(
      '/api/v1/admin/code-topics/import/extract-file',
      file,
      instructions,
      onProgress,
    ),

  confirmImport: (topics: CodeTopicPreview[]): Promise<{ imported: number; skipped: number }> =>
    apiClient.post('/api/v1/admin/code-topics/import/confirm', { topics }),

  aiFill: (title: string, category: string, difficulty: string, languages: string): Promise<CodeAIFillResponse> =>
    apiClient.post('/api/v1/admin/code-topics/ai-fill', { title, category, difficulty, languages }),

  aiFillFromImage: (image_b64: string): Promise<CodeAIFillResponse & { title?: string; category?: string; difficulty?: string; languages?: string }> =>
    apiClient.post('/api/v1/admin/code-topics/ai-fill-image', { image_b64 }),

  discoverStream: (
    url: string,
    humanFeedback?: string,
    cookies?: string,
    onLog?: (msg: string) => void,
    onPlan?: (steps: BrowserPlanStep[], reasoning: string) => void,
    onStep?: (index: number, status: BrowserStepStatus['status'], description: string, error?: string, screenshot_b64?: string) => void,
    onSession?: (sessionId: string) => void,
    onNeedsHuman?: (event: NeedsHumanEvent) => void,
    onResuming?: () => void,
    onScreenshot?: (screenshot_b64: string) => void,
  ): Promise<PageDiscovery> =>
    discoverStream('/api/v1/admin/code-topics/import/discover/stream', url, humanFeedback, cookies, onLog, onPlan, onStep, onSession, onNeedsHuman, onResuming, onScreenshot),

  sendDiscoverFeedback: (sessionId: string, instruction: string): Promise<void> =>
    sendDiscoverFeedback('/api/v1/admin/code-topics/import/discover/feedback', sessionId, instruction),
};

// ── Public practice API (authenticated users, active topics only) ──────────────

export const practiceApi = {
  listEnglishTopics: (params: {
    skill_focus?: string;
    level?: string;
    search?: string;
    target_language?: string;
    page?: number;
    per_page?: number;
  }): Promise<EnglishTopicListResponse> => {
    const q = new URLSearchParams();
    if (params.skill_focus) q.set('skill_focus', params.skill_focus);
    if (params.level) q.set('level', params.level);
    if (params.search) q.set('search', params.search);
    if (params.target_language) q.set('target_language', params.target_language);
    if (params.page) q.set('page', String(params.page));
    if (params.per_page) q.set('per_page', String(params.per_page));
    return apiClient.get(`/api/v1/practice/english-topics?${q.toString()}`);
  },

  getEnglishMeta: (): Promise<EnglishTopicMeta> =>
    apiClient.get('/api/v1/practice/english-topics/meta'),

  listCodeTopics: (params: {
    category?: string;
    difficulty?: string;
    search?: string;
    page?: number;
    per_page?: number;
  }): Promise<CodeTopicListResponse> => {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.difficulty) q.set('difficulty', params.difficulty);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.per_page) q.set('per_page', String(params.per_page));
    return apiClient.get(`/api/v1/practice/code-topics?${q.toString()}`);
  },

  getCodeMeta: (): Promise<CodeTopicMeta> =>
    apiClient.get('/api/v1/practice/code-topics/meta'),
};
