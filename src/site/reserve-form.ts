// S-10 pure helpers for the reservation form (brief 6.3, 6.4; S-11 request notes). No DOM, no storage,
// never throws, so they are unit-tested directly (test/unit/reserve-form.test.ts).
import { normalisePhone } from "../domain/phone";

export type NameCheck = { ok: true; name: string } | { ok: false };
export type NumberCheck = { ok: true; number: string } | { ok: false; needsPlus: boolean };

/**
 * Brief 6.3: 2 to 60 characters after trimming. Counted with String.length, exactly as
 * src/api/reserve.ts counts, so the site never refuses what the API takes (or the reverse).
 */
export function validateName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false };
  const name = raw.trim();
  return name.length >= 2 && name.length <= 60 ? { ok: true, name } : { ok: false };
}

/** The shared phone rules (src/domain/phone.ts). `needsPlus` lets the form say "add a +" for 91 + ten digits. */
export function checkNumber(raw: unknown): NumberCheck {
  const number = normalisePhone(raw);
  if (number !== null) return { ok: true, number };
  const digits = typeof raw === "string" ? raw.replace(/[\s\-.()]/g, "") : "";
  return { ok: false, needsPlus: /^91\d{10}$/.test(digits) };
}

/**
 * S-11: at least 128 random bits, matching ^[A-Za-z0-9-]{16,64}$. A UUID has only 122 random bits, so
 * this is 16 bytes from the browser's secure source as 32 hex digits. Never Math.random.
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

// ---- what the server said, in words for the buyer ----

/** Where a failure is shown: beside a field, or in the form-level alert. */
export type Failure =
  | { kind: "name" | "number"; text: string }
  | { kind: "form"; text: string; skipped?: { name: string; why: string }[]; newKey?: boolean };

export type Reply = { kind: "booked"; token: string; response: unknown } | Failure;

const TRY_AGAIN = "Something went wrong and your reservation was not confirmed. Please try again in a moment, or message me.";
const MESSAGES: Record<string, string> = {
  "invalid-basket": "Something is wrong with the items in your basket. You can reserve 1 to 15 items at a time, so please check the list above.",
  "too-many-claims": "That number already has too many reservations. Please message me if you need more.",
  "not-reserving": "Reservations are not open right now, so nothing was saved. Please check back soon.",
  busy: "The sale is busy at the moment. Please try again in a few seconds.",
};

/** Shown when a network error, timeout or unreadable answer means we do not know whether it saved. */
export const NOT_SURE: Failure = { kind: "form", text: TRY_AGAIN };

/**
 * Turns the parsed JSON answer into what the screen should do. The server's error text is never shown:
 * only the codes we know map to copy, everything else is the shared try-again line (PM, S-10).
 */
export function interpretReply(body: unknown): Reply {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (o.ok === true && typeof o.token === "string" && o.token.length > 0) return { kind: "booked", token: o.token, response: body };
  const code = o.ok === false && typeof o.error === "string" ? o.error : "";
  if (code === "invalid-name") return { kind: "name", text: "Please enter your name, 2 to 60 characters." };
  if (code === "invalid-number") return { kind: "number", text: "That doesn't look like a valid phone number. Please check it and try again." };
  if (code === "nothing-available") {
    const skipped = Array.isArray(o.skipped) ? o.skipped.map(skippedLine) : [];
    return { kind: "form", text: "Nothing in your basket is available any more, so nothing was reserved.", skipped };
  }
  if (code === "invalid-request") return { kind: "form", text: TRY_AGAIN, newKey: true }; // a rejected key must not be reused
  return { kind: "form", text: MESSAGES[code] ?? TRY_AGAIN };
}

function skippedLine(s: unknown): { name: string; why: string } {
  const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
  const name = typeof o.name === "string" && o.name.trim() ? o.name : "An item in your basket";
  return { name, why: o.reason === "sold-out" ? "sold out" : "no longer available" };
}
