// G1 / S-17 carried note: a booking that no longer exists stays in My reservations (localStorage "medley-sale:bookings:v1")
// forever. When the booking API answers `not-found` for a saved token, that token is dropped from the list. It is kept on
// a network error, a timeout-like failure, `busy`, `unavailable` (or any other non-answer): those can still succeed later.
// Red step. Tokens are synthetic. Page-level contract: opening #/b/<token> asks the API, and the answer decides.
import { test, expect, type Page } from "@playwright/test";
import { json, networkDown, serverError } from "./helpers";
import { BOOKINGS_KEY, OTHER_TOKEN, TOKEN, bookingReply, setupApi, type Post } from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
const saved = (p: Page) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as unknown, BOOKINGS_KEY);

async function visit(page: Page, list: string[], booking: Post, token = TOKEN) {
  await setupApi(page, { booking });
  // Seed once: an init script runs on every load, and the test reads what the page left behind.
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(k!, v!); sessionStorage.setItem("seeded", "1"); } }, [BOOKINGS_KEY, JSON.stringify(list)]);
  await page.goto(`/#/b/${token}`);
}

test.describe("not-found removes the token", () => {
  test("the missing booking leaves the list; the others stay, in order", async ({ page }) => {
    await visit(page, [OTHER_TOKEN, TOKEN], (r) => json({ ok: false, error: "not-found" })(r));
    await expect(t(page, "booking-notfound")).toBeVisible();
    await expect.poll(() => saved(page)).toEqual([OTHER_TOKEN]);
  });

  test("when it was the only saved booking, My reservations disappears from the catalogue", async ({ page }) => {
    await visit(page, [TOKEN], (r) => json({ ok: false, error: "not-found" })(r));
    await expect(t(page, "booking-notfound")).toBeVisible();
    await expect.poll(() => saved(page)).toEqual([]); // an empty list, not the stale token
    await t(page, "booking-back").click();
    await expect(t(page, "catalogue")).toBeVisible();
    await expect(t(page, "my-reservations")).toHaveCount(0);
  });

  test("the catalogue link then points at the newest remaining booking", async ({ page }) => {
    await visit(page, [TOKEN, OTHER_TOKEN], (r) => json({ ok: false, error: "not-found" })(r));
    await expect(t(page, "booking-notfound")).toBeVisible();
    await t(page, "booking-back").click();
    await expect(t(page, "my-reservations")).toHaveAttribute("href", `#/b/${OTHER_TOKEN}`);
  });

  test("a token that was never saved changes nothing (a mistyped link does not touch the list)", async ({ page }) => {
    await visit(page, [OTHER_TOKEN], (r) => json({ ok: false, error: "not-found" })(r));
    await expect(t(page, "booking-notfound")).toBeVisible();
    await page.waitForTimeout(200);
    expect(await saved(page)).toEqual([OTHER_TOKEN]);
  });

  test("with storage blocked the not-found message still shows and nothing throws", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const boom = (): never => { throw new DOMException("blocked", "SecurityError"); };
      for (const m of ["getItem", "setItem", "removeItem", "clear", "key"] as const) Storage.prototype[m] = boom;
    });
    await setupApi(page, { booking: (r) => json({ ok: false, error: "not-found" })(r) });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-notfound")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("anything else keeps the token", () => {
  const KEEP: [string, Post][] = [
    ["a network failure", networkDown],
    ["busy", (r) => json({ ok: false, error: "busy" })(r)],
    ["unavailable", (r) => json({ ok: false, error: "unavailable" })(r)],
    ["not-reserving", (r) => json({ ok: false, error: "not-reserving" })(r)],
    ["a server error", serverError],
  ];
  for (const [what, handler] of KEEP) {
    test(`${what}: the saved list is untouched`, async ({ page }) => {
      await visit(page, [OTHER_TOKEN, TOKEN], handler);
      await expect(t(page, "booking-error")).toBeVisible(); // the try-again state: not "not found"
      await page.waitForTimeout(200);
      expect(await saved(page)).toEqual([OTHER_TOKEN, TOKEN]);
    });
  }

  test("a good answer keeps it too", async ({ page }) => {
    await visit(page, [OTHER_TOKEN, TOKEN], (r) => json(bookingReply())(r));
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    expect(await saved(page)).toEqual([OTHER_TOKEN, TOKEN]);
  });

  test("a failed try is not final: after Try again succeeds the token is still there", async ({ page }) => {
    let down = true;
    await visit(page, [TOKEN], (r) => (down ? networkDown(r) : json(bookingReply())(r)));
    await expect(t(page, "booking-error")).toBeVisible();
    down = false;
    await t(page, "booking-retry").click();
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    expect(await saved(page)).toEqual([TOKEN]);
  });
});
