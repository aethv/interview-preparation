import { apiClient } from './client';

export interface ConfigEntry {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface ModelsResponse {
  vendor: string;
  models: string[];
}

export interface SecretStatus {
  name: string;
  label: string;
  env_var: string;
  /** stored = saved in the DB, environment = from .env, missing = not set */
  source: 'stored' | 'environment' | 'missing';
  /** Masked preview only — the API never returns a real secret value. */
  masked: string;
  is_set: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

/** Datasets that can be exported/imported from Admin (Users deliberately excluded). */
export type AdminDataset =
  | 'agent_config'
  | 'prompts'
  | 'question_bank'
  | 'language_topics'
  | 'code_topics';

export interface DatasetExport {
  dataset: AdminDataset;
  version: number;
  exported_at: string;
  count: number;
  items: Record<string, unknown>[];
}

export interface ImportSummary {
  dataset: string;
  imported: number;
  skipped: number;
  invalid: number;
  errors?: string[];
  /** Question bank only: how many imported rows got a search embedding. */
  embedded?: number;
}

export const adminApi = {
  exportDataset: (dataset: AdminDataset): Promise<DatasetExport> =>
    apiClient.get(`/api/v1/admin/export/${dataset}`),

  importDataset: (dataset: AdminDataset, payload: unknown): Promise<ImportSummary> =>
    apiClient.post(`/api/v1/admin/import/${dataset}`, payload),

  getModels: (vendor = 'openai'): Promise<ModelsResponse> =>
    apiClient.get(`/api/v1/admin/models?vendor=${vendor}`),

  getConfig: (): Promise<ConfigEntry[]> =>
    apiClient.get('/api/v1/admin/config'),

  updateConfig: (key: string, value: unknown): Promise<ConfigEntry> =>
    apiClient.put(`/api/v1/admin/config/${key}`, { value }),

  bulkUpdateConfig: (configs: { key: string; value: unknown; description?: string }[]): Promise<ConfigEntry[]> =>
    apiClient.post('/api/v1/admin/config/bulk', { configs }),

  resetConfig: (): Promise<ConfigEntry[]> =>
    apiClient.post('/api/v1/admin/config/reset'),

  listSecrets: (): Promise<SecretStatus[]> =>
    apiClient.get('/api/v1/admin/secrets'),

  updateSecret: (name: string, value: string): Promise<SecretStatus> =>
    apiClient.put(`/api/v1/admin/secrets/${name}`, { value }),

  deleteSecret: (name: string): Promise<{ name: string; deleted: boolean }> =>
    apiClient.delete(`/api/v1/admin/secrets/${name}`),

  testSecret: (name: string): Promise<{ ok: boolean; detail: string }> =>
    apiClient.post(`/api/v1/admin/secrets/${name}/test`, {}),

  listUsers: (): Promise<AdminUser[]> =>
    apiClient.get('/api/v1/admin/users'),

  updateUser: (userId: number, isAdmin: boolean): Promise<AdminUser> =>
    apiClient.patch(`/api/v1/admin/users/${userId}`, { is_admin: isAdmin }),
};
