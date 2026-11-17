const GUEST_SIGNOUT_KEY = 'trikeserve_guest_signout_notice';

/**
 * A guest has no password, so signing out ends their access to everything they
 * ordered: the anonymous session cannot be signed back into. The login screen
 * is the only place left to offer a real account, but `logout()` unmounts the
 * app before any component that could say so is mounted — so the fact is left
 * behind here for the login screen to pick up.
 */
export interface GuestSignoutNotice {
  /** The guest's name, so the prompt can address them instead of "user". */
  name: string;
  /** When the sign-out happened, so a notice from hours ago is ignored. */
  at: number;
}

/** Long enough to read the prompt, short enough that it cannot greet someone
 *  opening the app the next morning as if the sign-out had just happened. */
const NOTICE_MAX_AGE_MS = 30 * 60 * 1000;

export function rememberGuestSignout(name: string): void {
  try {
    window.sessionStorage.setItem(
      GUEST_SIGNOUT_KEY,
      JSON.stringify({ name: (name || '').trim(), at: Date.now() }),
    );
  } catch {
    // The login screen simply renders without the prompt.
  }
}

/** Reads the notice without consuming it, so a re-render does not lose it. */
export function peekGuestSignout(): GuestSignoutNotice | null {
  try {
    const raw = window.sessionStorage.getItem(GUEST_SIGNOUT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<GuestSignoutNotice>;
    if (typeof parsed?.at !== 'number' || Date.now() - parsed.at > NOTICE_MAX_AGE_MS) {
      clearGuestSignout();
      return null;
    }

    return { name: typeof parsed.name === 'string' ? parsed.name : '', at: parsed.at };
  } catch {
    return null;
  }
}

export function clearGuestSignout(): void {
  try {
    window.sessionStorage.removeItem(GUEST_SIGNOUT_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
