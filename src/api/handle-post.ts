// POST request handling (brief 4.3). Bodies arrive as text/plain JSON (no CORS
// preflight); tokens travel in the body, never the query string. Mirrors
// handle-get.ts: pure, every answer is a JSON string, and it never throws.

export interface PostDeps {
  /** Receives the parsed request object; its return value is the JSON answer. */
  reserve: (request: unknown) => unknown;
  /** S-12: read-only view of one booking, by token in the body. */
  booking: (request: unknown) => unknown;
  /** S-14: release one claim of a booking, by token and claim id in the body. */
  backOut: (request: unknown) => unknown;
  /** S-13: record that the buyer's browser went to WhatsApp, by token in the body. */
  waOpened: (request: unknown) => unknown;
}

export function handlePost(body: string | undefined, deps: PostDeps): string {
  let request: unknown;
  try {
    request = body ? JSON.parse(body) : undefined;
  } catch {
    request = undefined;
  }
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return JSON.stringify({ error: "bad request" });
  }
  // Exactly "reserve", "booking", "backOut" or "waOpened": no trimming or case folding, and the action is never echoed back.
  // Tokens come from this POST body only; doGet never routes these.
  const action = (request as { action?: unknown }).action;
  const handler = action === "reserve" ? deps.reserve
    : action === "booking" ? deps.booking
    : action === "backOut" ? deps.backOut
    : action === "waOpened" ? deps.waOpened
    : null;
  if (!handler) return JSON.stringify({ error: "unknown action" });
  try {
    return JSON.stringify(handler(request));
  } catch {
    // Generic on purpose: an exception message could contain a name or number (D-030 rule 8).
    return JSON.stringify({ error: "unavailable" });
  }
}
