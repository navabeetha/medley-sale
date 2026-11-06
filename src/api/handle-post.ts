// POST request handling (brief 4.3). Bodies arrive as text/plain JSON (no CORS
// preflight); tokens travel in the body, never the query string. Mirrors
// handle-get.ts: pure, every answer is a JSON string, and it never throws.

export interface PostDeps {
  /** Receives the parsed request object; its return value is the JSON answer. */
  reserve: (request: unknown) => unknown;
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
  // Exactly "reserve": no trimming or case folding, and the action is never echoed back.
  // S-12 and S-14 add booking, backOut and waOpened here.
  if ((request as { action?: unknown }).action !== "reserve") return JSON.stringify({ error: "unknown action" });
  try {
    return JSON.stringify(deps.reserve(request));
  } catch {
    // Generic on purpose: an exception message could contain a name or number (D-030 rule 8).
    return JSON.stringify({ error: "unavailable" });
  }
}
