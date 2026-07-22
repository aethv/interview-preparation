import { apiClient } from './client';

export interface VoiceTokenRequest {
  room_name: string;
  participant_name: string;
  participant_identity: string;
  can_publish?: boolean;
  can_subscribe?: boolean;
}

export interface VoiceTokenResponse {
  token: string;
  room_name: string;
  url: string;
}

export interface VoiceHealth {
  ok: boolean;
  problems: string[];
  detail: string;
}

export const voiceApi = {
  /** Why voice might not work (missing/rejected API key, LiveKit not configured). */
  health: (): Promise<VoiceHealth> =>
    apiClient.get('/api/v1/voice/health'),

  getToken: (data: VoiceTokenRequest): Promise<VoiceTokenResponse> =>
    apiClient.post('/api/v1/voice/token', data),
};
