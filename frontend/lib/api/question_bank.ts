import { apiClient } from './client';

export interface Question {
  id: number;
  category: string;
  subcategory: string | null;
  level: string;
  topic: string;
  question: string;
  answer: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionListResponse {
  items: Question[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface QuestionPreview {
  category: string;
  subcategory: string | null;
  level: string;
  topic: string;
  question: string;
  answer: string;
  source: string | null;
  status: 'new' | 'similar' | 'duplicate';
  similar_id: number | null;
  similarity_score: number | null;
}

export interface QuestionMeta {
  categories: string[];
  levels: string[];
}

export interface CreateQuestionBody {
  category: string;
  subcategory?: string;
  level: string;
  topic: string;
  question: string;
  answer: string;
  source?: string;
}

export const questionBankApi = {
  getMeta: (): Promise<QuestionMeta> =>
    apiClient.get('/api/v1/admin/questions/meta'),

  list: (params: {
    category?: string;
    level?: string;
    search?: string;
    page?: number;
    per_page?: number;
  }): Promise<QuestionListResponse> => {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.level) q.set('level', params.level);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.per_page) q.set('per_page', String(params.per_page));
    return apiClient.get(`/api/v1/admin/questions?${q.toString()}`);
  },

  create: (body: CreateQuestionBody): Promise<Question> =>
    apiClient.post('/api/v1/admin/questions', body),

  update: (id: number, body: Partial<CreateQuestionBody>): Promise<Question> =>
    apiClient.put(`/api/v1/admin/questions/${id}`, body),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/api/v1/admin/questions/${id}`),

  extractFromUrl: (url: string, instructions?: string): Promise<QuestionPreview[]> =>
    apiClient.post('/api/v1/admin/questions/import/extract-url', { url, instructions }),

  extractFromUrlStream: (
    url: string,
    instructions?: string,
    onLog?: (msg: string) => void,
  ): Promise<QuestionPreview[]> => {
    const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    return new Promise(async (resolve, reject) => {
      let response: Response;
      try {
        response = await fetch(`${BASE_URL}/api/v1/admin/questions/import/extract-url/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ url, instructions }),
        });
      } catch (e) {
        return reject(new Error('Network error'));
      }
      if (!response.ok) {
        return reject(new Error(`Server error: ${response.status}`));
      }
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
            let evt: { type: string; message?: string; data?: QuestionPreview[] };
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
  },

  extractFromFile: (
    file: File,
    instructions?: string,
    onProgress?: (p: number) => void,
  ): Promise<QuestionPreview[]> => {
    const form = new FormData();
    form.append('file', file);
    if (instructions) form.append('instructions', instructions);
    const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}/api/v1/admin/questions/import/extract-file`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve([] as QuestionPreview[]); }
        } else {
          try { reject(new Error(JSON.parse(xhr.responseText).detail || xhr.statusText)); } catch { reject(new Error(xhr.statusText)); }
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(form);
    });
  },

  confirmImport: (questions: QuestionPreview[]): Promise<{ imported: number; skipped: number }> =>
    apiClient.post('/api/v1/admin/questions/import/confirm', { questions }),
};
