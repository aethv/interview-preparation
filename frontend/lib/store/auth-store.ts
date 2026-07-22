import { create } from 'zustand';
import { apiClient } from '@/lib/api/client';

interface User {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_admin: boolean;
  created_at: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const data = await apiClient.post<{ access_token: string; token_type: string }>(
        '/api/v1/auth/login',
        { email, password }
      );
      localStorage.setItem('auth_token', data.access_token);
      const user = await apiClient.get<User>('/api/v1/auth/me');
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (email, password, fullName) => {
    set({ isLoading: true });
    try {
      await apiClient.post('/api/v1/auth/register', { email, password, full_name: fullName });
      const data = await apiClient.post<{ access_token: string; token_type: string }>(
        '/api/v1/auth/login',
        { email, password }
      );
      localStorage.setItem('auth_token', data.access_token);
      const user = await apiClient.get<User>('/api/v1/auth/me');
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    set({ user: null, isAuthenticated: false });
  },

  fetchUser: async () => {
    set({ isLoading: true });
    try {
      const user = await apiClient.get<User>('/api/v1/auth/me');
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      localStorage.removeItem('auth_token');
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
