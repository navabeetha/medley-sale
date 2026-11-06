// POST to the Apps Script API (S-10 reserve, S-12 booking and waOpened, S-14 backOut). Shared so every call is made the
// same way: a JSON body as text/plain, no query string, and a timeout.
import { API_URL } from "./config";

/**
 * text/plain keeps this a "simple" request: Apps Script cannot answer a CORS preflight (brief 4.2). Tokens travel in
 * the body only (brief 4.3). Rejects on a network error, a timeout, a non-2xx status or an unreadable answer.
 */
export async function postJson(body: object, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error("http");
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
