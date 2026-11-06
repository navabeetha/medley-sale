// Shared by booking-page.spec.ts (S-12) and back-out.spec.ts (S-14): a mocked API that answers the catalogue GET and
// the booking / backOut / reserve POSTs, plus synthetic booking fixtures. Shapes follow src/api/booking.ts,
// src/api/back-out.ts and src/api/reserve.ts. Synthetic data only; the seller's URL is the fixture's fictional one.
import type { Page, Route } from "@playwright/test";
import { ITEMS, response } from "../fixtures/catalogue-fixture";
import { json, mockApi, mockPhotos, ok } from "./helpers";

// Lowercase hex on purpose: a mixed-case 40+ char run looks like a sheet ID to tools/pii-scan.mjs.
export const TOKEN = ["0f1e2d3c4b5a6978", "8796a5b4c3d2e1f0"].join("");
export const OTHER_TOKEN = ["aa11bb22cc33dd44", "ee55ff6600771188"].join("");
export const LAST_BOOKING_KEY = "medley-sale:last-booking:v1";
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
export const bookingReply = (booking: Json = FULL_VIEW, whatsappUrl: string | null = "https://wa.me/919000000001?text=x") =>
  ({ ok: true, booking, whatsappUrl });
export const TELL_URL = "https://wa.me/919000000001?text=Hi!%20I'm%20Asha%20Testperson.%20I've%20backed%20out%20of%20Test%20Picture%20Frame.";
export const backOutReply = (booking: Json, tellSellerUrl: string | null = TELL_URL) =>
  ({ ok: true, booking, whatsappUrl: null, tellSellerUrl });

export type Post = (route: Route, sent: Sent) => Promise<void> | void;
export interface Api {
  sent: Sent[];
  gets: string[];
  /** Replace how one action is answered. */
  on(action: "booking" | "backOut" | "reserve", h: Post): void;
  setCatalogue(c: unknown): void;
}

export async function setupApi(page: Page, handlers: Partial<Record<"booking" | "backOut" | "reserve", Post>> = {}, catalogue: unknown = { ...response(ITEMS), reserving: true }): Promise<Api> {
  const h: Record<string, Post> = {
    booking: (r) => json(bookingReply())(r),
    backOut: (r) => json(backOutReply(FULL_VIEW))(r),
    reserve: (r) => json({ ok: true, token: TOKEN, bookingId: 7, units: [], skipped: [], whatsappUrl: null })(r),
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
