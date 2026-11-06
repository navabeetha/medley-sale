// S-12 booking page at #/b/<token> (brief 2.7, 4.3, 4.4, 6.1 rule 8, 6.4; D-005; T-11, T-14) plus F3 from the S-10
// QA (a successful booking lands here). Written BEFORE the code: every test must fail on the current site.
// API mocked; synthetic data only.
//
// DOM CONTRACT pinned here (data-testid):
//   Routing   hash "#/b/<token>" (token URI-encoded) shows the booking page INSTEAD of the catalogue ("catalogue"
//             is hidden), on a direct load, a reload and after hashchange. Other hashes show the catalogue.
//   Request   POST to API_URL, no query string, Content-Type text/plain, body JSON with EXACTLY the keys
//             action ("booking") and token (decoded). The token is never in a URL's query string.
//   booking-loading   shown while waiting. booking-back  <a href="#/"> to the sale.
//   booking-notfound  plain message (no error codes, no list) for {ok:false,error:"not-found"}: T-11.
//   booking-error     role="alert" when the request fails; booking-retry <button> sends the request again.
//   Groups    booking-group-reserved / -waiting / -sold / -ended: present ONLY when non-empty, in that order, each with
//             a heading: "Reserved", "Waiting", "Sold to you", "Ended". Inside: booking-line, text from the API line:
//             reserved/sold/ended "<name> × <quantity>" (the "× n" only when quantity > 1); waiting
//             "<name>" and "position <n>"; a waiting line with itemSold also says "This item was sold" (6.1.8).
//   booking-saved     the 6.4 line "Your reservation is saved, even if you don't send the message." when found.
//   booking-skipped   list of booking-skipped-item (name + "sold out" / "no longer available"), from the stored
//                     reserve answer in sessionStorage "medley-sale:last-booking:v1", ONLY when its token is this page's.
//   Saved list  localStorage "medley-sale:bookings:v1" (D-005): a JSON array of tokens ONLY (no names, no numbers),
//             newest first, written when a booking succeeds (a token already in the list moves to the front, once).
//   my-reservations   <a href="#/b/<newest token>"> in the header on the catalogue and booking screens while the list
//             has at least one valid token (a non-empty string). Works in a new tab (it is localStorage).
//             With 2 or more tokens, "my-reservations-item" links (<a href="#/b/<token>">), one per token,
//             newest first, are also shown. Corrupt or blocked storage: no link, no crash; junk entries are skipped.
//   booking-whatsapp  <a> to the reply's whatsappUrl (only when it starts "https://wa.me/"), target _blank, rel noopener.
//             Tapping it POSTs {action:"waOpened", token} (text/plain, body only, no query string) at most once per
//             page view, without waiting for the answer and ignoring its failure: the link still opens.
//   All data via textContent.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS } from "../fixtures/catalogue-fixture";
import { json, hang, networkDown } from "./helpers";
import {
  BOOKINGS_KEY, FULL_VIEW, LAST_BOOKING_KEY, OTHER_TOKEN, SAVED_LINE, TOKEN, blockStorage, bookingReply, line, setupApi,
} from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
const hash = (p: Page) => p.evaluate(() => location.hash);
const lineFor = (p: Page, group: string, name: string) =>
  t(p, `booking-group-${group}`).getByTestId("booking-line").filter({ hasText: name });

test.describe("the page and its request", () => {
  test("a direct load of #/b/<token> posts exactly {action, token} in the body and hides the catalogue", async ({ page }) => {
    const api = await setupApi(page);
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    await expect(t(page, "catalogue")).toBeHidden();
    const posts = api.sent.filter((s) => s.body.action === "booking");
    expect(posts).toHaveLength(1);
    expect(Object.keys(posts[0]!.body).sort()).toEqual(["action", "token"]);
    expect(posts[0]!.body.token).toBe(TOKEN);
    expect(posts[0]!.contentType).toMatch(/^text\/plain/);
    expect(new URL(posts[0]!.url).search).toBe("");
    for (const u of [...api.gets, ...api.sent.map((s) => s.url)]) expect(u, "token never in a URL").not.toContain(TOKEN);
  });

  test("shows a loading line while waiting", async ({ page }) => {
    await setupApi(page, { booking: hang });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-loading")).toBeVisible();
  });

  test("following a #/b/<token> link on a loaded page switches to the booking page and Back to the sale returns", async ({ page }) => {
    await setupApi(page);
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await page.evaluate((tok) => { location.hash = `#/b/${tok}`; }, TOKEN);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    await expect(t(page, "catalogue")).toBeHidden();
    await t(page, "booking-back").click();
    await expect(t(page, "catalogue")).toBeVisible();
    await expect(t(page, "booking-group-reserved")).toHaveCount(0);
  });
});

test.describe("groups", () => {
  test("shows Reserved, Waiting, Sold to you and Ended, each with its heading and only when non-empty", async ({ page }) => {
    await setupApi(page);
    await page.goto(`/#/b/${TOKEN}`);
    for (const [g, heading] of [["reserved", "Reserved"], ["waiting", "Waiting"], ["sold", "Sold to you"], ["ended", "Ended"]] as const) {
      await expect(t(page, `booking-group-${g}`)).toBeVisible();
      await expect(t(page, `booking-group-${g}`).getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    const order = await page.locator('[data-testid^="booking-group-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
    expect(order).toEqual(["booking-group-reserved", "booking-group-waiting", "booking-group-sold", "booking-group-ended"]);
  });

  test("an empty group is not shown", async ({ page }) => {
    await setupApi(page, { booking: (r) => json(bookingReply({ ...FULL_VIEW, waiting: [], sold: [], ended: [] }))(r) });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    for (const g of ["waiting", "sold", "ended"]) await expect(t(page, `booking-group-${g}`)).toHaveCount(0);
  });

  test("a multi-unit item is one line, 'Test Picture Frame × 2'; a single unit has no multiplier", async ({ page }) => {
    await setupApi(page);
    await page.goto(`/#/b/${TOKEN}`);
    await expect(lineFor(page, "reserved", "Test Picture Frame")).toHaveText(/Test Picture Frame\s*×\s*2/);
    await expect(t(page, "booking-group-reserved").getByTestId("booking-line")).toHaveCount(2);
    await expect(lineFor(page, "reserved", "Test Mug")).not.toHaveText(/×/);
  });

  test("a waiting line shows its position; a sold-out waiter is told 'This item was sold'", async ({ page }) => {
    await setupApi(page);
    await page.goto(`/#/b/${TOKEN}`);
    await expect(lineFor(page, "waiting", "Test Lamp")).toHaveText(/position 3\b/i);
    await expect(lineFor(page, "waiting", "Test Lamp")).not.toHaveText(/This item was sold/i);
    await expect(lineFor(page, "waiting", "Test Radio")).toHaveText(/This item was sold/i);
  });

  test("sold and ended lines name the item", async ({ page }) => {
    await setupApi(page);
    await page.goto(`/#/b/${TOKEN}`);
    await expect(lineFor(page, "sold", "Test Kettle")).toBeVisible();
    await expect(lineFor(page, "ended", "Test Fan")).toBeVisible();
  });

  test("item names are shown as text, never as markup", async ({ page }) => {
    const evil = { ...FULL_VIEW, reserved: [line("I-9101", "<b id=\"pwn\">Bold</b> Frame", [11])] };
    await setupApi(page, { booking: (r) => json(bookingReply(evil))(r) });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toContainText('<b id="pwn">Bold</b> Frame');
    await expect(page.locator("#pwn")).toHaveCount(0);
  });
});

test.describe("the saved line and the skipped items", () => {
  test("shows the section 6.4 'saved' line", async ({ page }) => {
    await setupApi(page);
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-saved")).toHaveText(SAVED_LINE);
  });

  test("after a booking that skipped items, the page lists them by name with the reason", async ({ page }) => {
    const skipped = [
      { id: "I-9002", name: "Test Lamp", reason: "sold-out" },
      { id: "I-9004", name: "Synthetic Novel", reason: "unavailable" },
    ];
    await setupApi(page, { reserve: (r) => json({ ok: true, token: TOKEN, bookingId: 7, units: [], skipped, whatsappUrl: null })(r) });
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await page.locator('[data-testid="item-row"][data-id="I-9001"]').getByTestId("add-button").click();
    await t(page, "basket-reserve").click();
    await t(page, "reserve-name").fill("Asha Testperson");
    await t(page, "reserve-number").fill("90000 00012");
    await t(page, "reserve-submit").click();
    await expect.poll(() => hash(page)).toBe(`#/b/${TOKEN}`);
    const items = t(page, "booking-skipped").getByTestId("booking-skipped-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Test Lamp");
    await expect(items.nth(0)).toContainText(/sold out/i);
    await expect(items.nth(1)).toContainText("Synthetic Novel");
    await expect(items.nth(1)).toContainText(/no longer available/i);
  });

  test("skipped items of another booking are not shown, and none shown when nothing was skipped", async ({ page }) => {
    await setupApi(page);
    const stored = { ok: true, token: OTHER_TOKEN, skipped: [{ id: "I-9002", name: "Test Lamp", reason: "sold-out" }] };
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k!, v!), [LAST_BOOKING_KEY, JSON.stringify(stored)]);
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    await expect(t(page, "booking-skipped")).toHaveCount(0);
  });
});

test.describe("failures", () => {
  test("an unknown token gets a plain not-found message and no groups (T-11)", async ({ page }) => {
    await setupApi(page, { booking: (r) => json({ ok: false, error: "not-found" })(r) });
    await page.goto(`/#/b/${OTHER_TOKEN}`);
    await expect(t(page, "booking-notfound")).toBeVisible();
    await expect(t(page, "booking-notfound")).toHaveText(/not found|couldn't find|can't find/i);
    await expect(t(page, "booking-notfound")).not.toHaveText(/not-found|error/i); // no code, no jargon
    for (const g of ["reserved", "waiting", "sold", "ended"]) await expect(t(page, `booking-group-${g}`)).toHaveCount(0);
    await expect(t(page, "booking-saved")).toHaveCount(0);
  });

  test("a token with odd characters is sent decoded, and a bare '#/b/' is just not found", async ({ page }) => {
    const api = await setupApi(page, { booking: (r) => json({ ok: false, error: "not-found" })(r) });
    await page.goto(`/#/b/${encodeURIComponent("a b/c")}`);
    await expect(t(page, "booking-notfound")).toBeVisible();
    expect(api.sent.find((s) => s.body.action === "booking")?.body.token).toBe("a b/c");
    await page.goto("/#/b/");
    await page.reload();
    await expect(t(page, "booking-notfound")).toBeVisible();
  });

  test("a network failure shows a retryable alert, and Retry sends the request again", async ({ page }) => {
    let down = true;
    const api = await setupApi(page, { booking: (r) => (down ? networkDown(r) : json(bookingReply())(r)) });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-error")).toHaveAttribute("role", "alert");
    await expect(t(page, "booking-notfound")).toHaveCount(0); // a failure is not "not found"
    down = false;
    await t(page, "booking-retry").click();
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    await expect(t(page, "booking-error")).toHaveCount(0);
    expect(api.sent.filter((s) => s.body.action === "booking")).toHaveLength(2);
  });
});

test.describe("F3 and the saved link", () => {
  async function book(page: Page): Promise<void> {
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await page.locator('[data-testid="item-row"][data-id="I-9001"]').getByTestId("add-button").click();
    await t(page, "basket-reserve").click();
    await t(page, "reserve-name").fill("Asha Testperson");
    await t(page, "reserve-number").fill("90000 00012");
    await t(page, "reserve-submit").click();
  }

  test("F3: a successful booking lands on #/b/<token> and shows that booking", async ({ page }) => {
    const api = await setupApi(page);
    await book(page);
    await expect.poll(() => hash(page)).toBe(`#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    expect(api.sent.filter((s) => s.body.action === "booking").map((s) => s.body.token)).toEqual([TOKEN]);
  });

  test("no My reservations link before anything is saved", async ({ page }) => {
    await setupApi(page);
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await expect(t(page, "my-reservations")).toHaveCount(0);
  });

  test("after a booking, My reservations is in the header on the catalogue and leads to the booking", async ({ page }) => {
    await setupApi(page);
    await book(page);
    await expect.poll(() => hash(page)).toBe(`#/b/${TOKEN}`);
    await t(page, "booking-back").click();
    await expect(t(page, "catalogue")).toBeVisible();
    const link = t(page, "my-reservations");
    await expect(link).toBeVisible();
    await expect(link).toHaveText(/My reservations/);
    await expect(link).toHaveAttribute("href", `#/b/${TOKEN}`);
    await link.click();
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    expect(await hash(page)).toBe(`#/b/${TOKEN}`);
  });

  test("My reservations survives a closed tab: a brand-new tab on the same device still has it (localStorage)", async ({ page }) => {
    await setupApi(page);
    await book(page);
    await expect.poll(() => hash(page)).toBe(`#/b/${TOKEN}`);
    const stored = await page.evaluate((k) => localStorage.getItem(k), BOOKINGS_KEY);
    expect(JSON.parse(stored ?? "null")).toEqual([TOKEN]); // tokens only
    expect(stored).not.toMatch(/Asha|9000/); // no name, no number
    const tab = await page.context().newPage();
    await tab.goto("/");
    await expect(t(tab, "my-reservations")).toHaveAttribute("href", `#/b/${TOKEN}`);
  });

  test("the list is newest first: the link goes to the newest booking and every booking is listed", async ({ page }) => {
    await setupApi(page);
    await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k!)) localStorage.setItem(k!, v!); }, [BOOKINGS_KEY, JSON.stringify([OTHER_TOKEN, TOKEN])]);
    await page.goto("/");
    await expect(t(page, "my-reservations")).toHaveAttribute("href", `#/b/${OTHER_TOKEN}`);
    const items = t(page, "my-reservations-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute("href", `#/b/${OTHER_TOKEN}`);
    await expect(items.nth(1)).toHaveAttribute("href", `#/b/${TOKEN}`);
  });

  test("a new booking goes to the front of the list, and the same token is never listed twice", async ({ page }) => {
    await setupApi(page);
    await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k!)) localStorage.setItem(k!, v!); }, [BOOKINGS_KEY, JSON.stringify([OTHER_TOKEN, TOKEN])]);
    await book(page); // the mocked reserve answers TOKEN again
    await expect.poll(() => hash(page)).toBe(`#/b/${TOKEN}`);
    const stored = await page.evaluate((k) => localStorage.getItem(k), BOOKINGS_KEY);
    expect(JSON.parse(stored ?? "null")).toEqual([TOKEN, OTHER_TOKEN]);
  });

  test("junk in the saved list is skipped; with nothing valid there is no link and no crash", async ({ page }) => {
    await setupApi(page);
    for (const junk of ["not json", "{}", "null", "[5]", '[""]', "[null,{}]"]) {
      await page.addInitScript((v) => localStorage.setItem("medley-sale:bookings:v1", v), junk);
      await page.goto("/");
      await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
      await expect(t(page, "my-reservations")).toHaveCount(0);
    }
    await page.addInitScript((v) => localStorage.setItem("medley-sale:bookings:v1", v), JSON.stringify([5, TOKEN, ""]));
    await page.goto("/");
    await expect(t(page, "my-reservations")).toHaveAttribute("href", `#/b/${TOKEN}`);
  });

  test("a saved last-booking in sessionStorage alone (the old place) does not make a link", async ({ page }) => {
    await setupApi(page);
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k!, v!), [LAST_BOOKING_KEY, JSON.stringify({ ok: true, token: TOKEN })]);
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await expect(t(page, "my-reservations")).toHaveCount(0);
  });

  test("T-14: with storage blocked a booking still lands on a working booking page", async ({ page }) => {
    await blockStorage(page);
    await setupApi(page);
    await book(page);
    await expect.poll(() => hash(page)).toBe(`#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    await expect(t(page, "booking-saved")).toHaveText(SAVED_LINE);
  });
});

test.describe("waOpened when the WhatsApp link is tapped", () => {
  const WA = "https://wa.me/919000000001?text=x";
  const opened = (api: { sent: { body: Record<string, unknown> }[] }) => api.sent.filter((s) => s.body.action === "waOpened");

  async function load(page: Page, waOpened?: Parameters<typeof setupApi>[1]) {
    // Never reach the real wa.me: anything the link opens is answered locally.
    await page.context().route(/^https:\/\/wa\.me\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>x</p>" }));
    const api = await setupApi(page, waOpened);
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    return api;
  }

  test("the link goes to the reply's whatsappUrl in a new tab; nothing is posted before a tap", async ({ page }) => {
    const api = await load(page);
    const a = t(page, "booking-whatsapp");
    await expect(a).toHaveAttribute("href", WA);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
    expect(opened(api)).toHaveLength(0);
  });

  test("a tap POSTs exactly {action, token} in the body, once however many taps", async ({ page }) => {
    const api = await load(page);
    await t(page, "booking-whatsapp").click();
    await t(page, "booking-whatsapp").click();
    await expect.poll(() => opened(api).length).toBe(1);
    await page.waitForTimeout(300);
    expect(opened(api)).toHaveLength(1);
    const sent = api.sent.find((s) => s.body.action === "waOpened")!;
    expect(Object.keys(sent.body).sort()).toEqual(["action", "token"]);
    expect(sent.body.token).toBe(TOKEN);
    expect(sent.contentType).toMatch(/^text\/plain/);
    expect(new URL(sent.url).search).toBe("");
    expect(sent.url).not.toContain(TOKEN);
  });

  test("the link still opens while the POST is unanswered", async ({ page }) => {
    await load(page, { waOpened: hang });
    const [tab] = await Promise.all([page.context().waitForEvent("page", { timeout: 3000 }), t(page, "booking-whatsapp").click()]);
    expect(tab.url()).toMatch(/^https:\/\/wa\.me\/|^about:blank$/);
  });

  test("a failed POST is ignored: the link opens and no alert appears", async ({ page }) => {
    await load(page, { waOpened: networkDown });
    const [tab] = await Promise.all([page.context().waitForEvent("page", { timeout: 3000 }), t(page, "booking-whatsapp").click()]);
    expect(tab).toBeTruthy();
    await page.waitForTimeout(300);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("no WhatsApp link when the reply has no whatsappUrl or a non-wa.me one", async ({ page }) => {
    for (const url of [null, "javascript:alert(1)", "https://example.com/?text=x"]) {
      const p = await page.context().newPage();
      await setupApi(p, { booking: (r) => json(bookingReply(FULL_VIEW, url))(r) });
      await p.goto(`/#/b/${TOKEN}`);
      await expect(t(p, "booking-group-reserved")).toBeVisible();
      await expect(t(p, "booking-whatsapp")).toHaveCount(0);
      await p.close();
    }
  });
});
