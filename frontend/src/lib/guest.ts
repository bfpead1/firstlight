// Guest mode: lets someone without an approved account try every page with sample data.
// It runs entirely in the browser: API calls are answered by lib/demo/handler.ts instead of
// the server, so guests never reach Google, Canvas, the AI providers or the database.
// Changes last for the browser tab (sessionStorage) and are never sent anywhere.

const FLAG_KEY = "firstlight_guest";

export function isGuest() {
  try {
    return sessionStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function enterGuest() {
  try {
    sessionStorage.setItem(FLAG_KEY, "1");
  } catch {
    // Storage blocked: guest mode can't persist, so it simply won't turn on.
  }
}

export function exitGuest() {
  try {
    sessionStorage.removeItem(FLAG_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** fetch() for the app's own /api routes: the sample API in guest mode, the server otherwise. */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isGuest() && url.startsWith("/api/")) {
    const { handleDemoRequest } = await import("./demo/handler");
    return handleDemoRequest(url, init);
  }
  return fetch(url, { credentials: "same-origin", ...init });
}
