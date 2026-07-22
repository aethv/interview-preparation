import { create } from 'zustand';

/**
 * Tracks whether a live voice session is in progress.
 *
 * Navigating away mid-session used to leave the LiveKit room connected and the
 * polling queries running, which flooded the network tab and starved other
 * requests. The navbar reads this to lock navigation until the user explicitly
 * pauses or completes.
 */
interface SessionState {
  activeInterviewId: number | null;
  isActive: boolean;
  startSession: (interviewId: number) => void;
  endSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeInterviewId: null,
  isActive: false,
  startSession: (interviewId) =>
    set({ activeInterviewId: interviewId, isActive: true }),
  endSession: () => set({ activeInterviewId: null, isActive: false }),
}));
