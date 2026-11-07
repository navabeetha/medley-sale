// Shared by booking-page.spec.ts (S-12) and back-out.spec.ts (S-14): a mocked API that answers the catalogue GET and
// the booking / backOut / reserve POSTs, plus synthetic booking fixtures. Shapes follow src/api/booking.ts,
// src/api/back-out.ts and src/api/reserve.ts. Synthetic data only; the seller's URL is the fixture's fictional one.
import type { Page, Route } from "@playwright/test";
import { ITEMS, response } from "../fixtures/catalogue-fixture";
import { json, mockApi, mockPhotos, ok } from "./helpers";

// Lowercase hex on purpose: a mixed-case 40+ char run looks like a sheet ID to tools/pii-scan.mjs.
export const TOKEN = ["0f1e2d3c4b5a6978", "8796a5b4c3d2e1f0"].join("");
export const OTHER_TOKEN = ["aa11bb22cc33dd44", "ee55ff6600771188"].join("");
export const LAST_BOOKING_KEY = "medley-sale:last-booking:v1"; // sessionStorage: the last reserve answer (skipped items)
export const BOOKINGS_KEY = "medley-sale:bookings:v1"; // localStorage (D-005): JSON array of tokens, newest first
export const SAVED_LINE = "Your reservation is saved, even if you don't send the message.";

export type Json = Record<string, unknown>;
export interface Sent { url: string; method: string; contentType: string; raw: string; body: Json }

export const line = (itemId: string, name: string, claimIds: number[], detail: string | null = null) =>
  ({ itemId, name, detail, isBook: false, quantity: claimIds.length, claimIds });
export const waiting = (claimId: number, itemId: string, name: string, position: number, itemSold = false) =>
  ({ claimId, itemId, name, detail: null, isBook: false, position, itemSold });

/** One of everything: 2 frames held, a lamp (3rd) and a radio (sold out) waited for, a kettle sold, a fan ended. */
export const FULL_VIEW = {
  bookingId: 7,
  name: "Asha Testperson",
  reserved: [line("I-9101", "Test Picture Frame", [11, 12], "Framecraft"), line("I-9105", "Test Mug", [17])],
  waiting: [waiting(13, "I-9002", "Test Lamp", 3), waiting(14, "I-9102", "Test Radio", 1, true)],
  sold: [line("I-9001", "Test Kettle", [15])],
  ended: [line("I-9103", "Test Fan", [16])],
};
export const WA_URL = "https://wa.me/919000000001?text=x";
/** The G1 "tell the seller you backed out" link (booking().backedOutUrl): one message for everything backed out. */
export const BACKED_OUT_URL = "https://wa.me/919000000001?text=Hi!%20I'm%20Asha%20Testperson.%20I've%20backed%20out%20of%20Test%20Fan.";
export const bookingReply = (booking: Json = FULL_VIEW, whatsappUrl: string | null = WA_URL, backedOutUrl: string | null = null) =>
  ({ ok: true, booking, whatsappUrl, backedOutUrl });
export const TELL_URL = "https://wa.me/919000000001?text=Hi!%20I'm%20Asha%20Testperson.%20I've%20backed%20out%20of%20Test%20Picture%20Frame.";
// Shape of the real backOut answer (src/api/back-out.ts): the booking, the UPDATED whatsappUrl (the real API does not answer
// null while the buyer still holds or waits for something), the single-item tellSellerUrl (the page no longer uses it since
// G1) and the booking's backedOutUrl (what the page uses for "Tell the seller you backed out").
export const backOutReply = (booking: Json, backedOutUrl: string | null = BACKED_OUT_URL, whatsappUrl: string | null = WA_URL, tellSellerUrl: string | null = TELL_URL) =>
  ({ ok: true, booking, whatsappUrl, tellSellerUrl, backedOutUrl });

// ---- S-19: the `mine` answer (see test/unit/mine.test.ts for the full contract) ----
export const BUYER_KEY = "medley-sale:buyer:v1"; // localStorage: the remembered buyer, JSON {name, number}
export const BUYER_NAME = "Asha Testperson";
export const BUYER_NUMBER = ["+91", "90000", "00012"].join(" "); // synthetic, built in parts for the personal-data scan
export const BUYER_JSON = JSON.stringify({ name: BUYER_NAME, number: BUYER_NUMBER });
/** Every unit in a `mine` answer carries the token of ITS booking. */
export const tok = <T extends Json>(token: string, l: T) => ({ ...l, token });
/** Held: 2 frames of one booking (TOKEN) and a mug of another (OTHER_TOKEN); waiting: a lamp (TOKEN, 3rd); sold: a kettle (TOKEN); backed out: a fan (OTHER_TOKEN). */
export const MINE_VIEW = {
  reserved: [tok(TOKEN, line("I-9101", "Test Picture Frame", [11, 12], "Framecraft")), tok(OTHER_TOKEN, line("I-9105", "Test Mug", [17]))],
  waiting: [tok(TOKEN, waiting(13, "I-9002", "Test Lamp", 3))],
  sold: [tok(TOKEN, line("I-9001", "Test Kettle", [15]))],
  backedOut: [tok(OTHER_TOKEN, line("I-9103", "Test Fan", [16]))],
};
export const MINE_WA_URL = "https://wa.me/919000000001?text=all%20reserved";
export const MINE_BACKED_OUT_URL = "https://wa.me/919000000001?text=all%20backed%20out";
export const mineReply = (over: Json = {}) =>
  ({ ok: true, ...MINE_VIEW, notFound: [], whatsappUrl: MINE_WA_URL, backedOutUrl: MINE_BACKED_OUT_URL, ...over });
/** The "My details" and "Forget" keys, plus the saved list, put in localStorage once per tab (a reload does not re-seed). */
export async function seedStorage(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((e) => {
    if (sessionStorage.getItem("seeded")) return;
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
    sessionStorage.setItem("seeded", "1");
  }, entries);
}

export type Post = (route: Route, sent: Sent) => Promise<void> | void;
export interface Api {
  sent: Sent[];
  gets: string[];
  /** Replace how one action is answered. */
  on(action: "booking" | "backOut" | "reserve" | "waOpened" | "mine", h: Post): void;
  setCatalogue(c: unknown): void;
}

export async function setupApi(page: Page, handlers: Partial<Record<"booking" | "backOut" | "reserve" | "waOpened" | "mine", Post>> = {}, catalogue: unknown = { ...response(ITEMS), reserving: true }): Promise<Api> {
  const h: Record<string, Post> = {
    booking: (r) => json(bookingReply())(r),
    backOut: (r) => json(backOutReply(FULL_VIEW))(r),
    reserve: (r) => json({ ok: true, token: TOKEN, bookingId: 7, units: [], skipped: [], whatsappUrl: null })(r),
    waOpened: (r) => json({ ok: true })(r),
    mine: (r) => json(mineReply())(r),
    ...handlers,
  };
  const api: Api = {
    sent: [], gets: [],
    on: (a, fn) => { h[a] = fn; },
    setCatalogue: (c) => { catalogue = c; },
  };
  await mockPhotos(page);
  await mockApi(page, async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const raw = req.postData() ?? "";
      let body: Json = {};
      try { body = JSON.parse(raw) as Json; } catch { /* left empty: the test will say so */ }
      const sent = { url: req.url(), method: "POST", contentType: req.headers()["content-type"] ?? "", raw, body };
      api.sent.push(sent);
      const fn = h[String(body.action)];
      return fn ? fn(route, sent) : json({ error: "unknown action" })(route);
    }
    api.gets.push(req.url());
    return ok(catalogue)(route);
  });
  return api;
}

/** Makes every localStorage / sessionStorage call throw, as a blocked-storage browser does (T-14). */
export async function blockStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const boom = (): never => { throw new DOMException("blocked", "SecurityError"); };
    for (const m of ["getItem", "setItem", "removeItem", "clear", "key"] as const) Storage.prototype[m] = boom;
  });
}
