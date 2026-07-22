/** User media preferences, persisted across sessions.
 *
 * Sessions default to audio-only: the agent subscribes to audio only
 * (AutoSubscribe.AUDIO_ONLY), so a published camera track costs LiveKit
 * bandwidth and minutes while being consumed by nothing but the local preview.
 * The camera stays available behind the toggle in RoomControls.
 */

const CAMERA_PREF_KEY = 'interviewlab.camera-enabled';

/** Whether the camera should be published automatically on connect. */
export function getCameraPreference(): boolean {
  // Guard for SSR: this module is imported by client components that Next.js
  // still renders on the server during the first pass.
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CAMERA_PREF_KEY) === 'true';
  } catch {
    // Private mode / storage disabled — fall back to audio-only
    return false;
  }
}

export function setCameraPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CAMERA_PREF_KEY, String(enabled));
  } catch {
    // Preference simply won't persist; the in-session toggle still works
  }
}
