// S-19: one "My reservations" page at #/mine (the seller at G1: "a single view of all reservations of mine, a list of back
// outs, buttons to inform each"). Red step: written before the code, so every test must fail on the current site.
// API mocked; synthetic data only; WhatsApp links are only asserted, never followed.
//
// DOM CONTRACT pinned here (data-testid). The details section and Forget are in mine-details.spec.ts, the 320 / 390 px layout
// in mine-layout.spec.ts.
//   Route     hash "#/mine" shows the page ("mine-page") INSTEAD of the catalogue; the hash is exactly "#/mine" (no token).
//             "#/b/<token>" still works as before (WhatsApp links point at it).
//   Header    "my-reservations" (every screen that had it) now has href "#/mine". The per-booking
//             "my-reservations-item" links are gone: there is one page, not a list of pages.
//   Request   on opening, ONE POST {action:"mine", tokens:[...]} (exactly those keys, text/plain, no query string): the saved
//             tokens of medley-sale:bookings:v1, newest first, at most the 20 newest. No request when nothing valid is saved.
//   mine-back         <a href="#/"> to the sale.      mine-loading   while waiting.
//   mine-empty        "no saved reservations" copy (case-insensitive), when storage holds no valid token, is blocked or corrupt.
//   mine-error        role="alert" when the request fails or answers an error; mine-retry <button> asks again.
//   Sections  "mine-group-reserved" (heading "Reserved": the held units AND the waiting units), "mine-group-sold" (heading
//             "Sold to you"), "mine-group-backedout" (heading "Backed out"). Each only when non-empty, in that order, then
//             "mine-details". Lines are "mine-line": held "<name> × <n>" (the "× n" only when n > 1), waiting "<name>" and
//             "Waiting list position <n>".
//   mine-whatsapp     <a> INSIDE mine-group-reserved, after its last line, text containing "Send the details to the seller",
//                     href = the answer's whatsappUrl; absent when null or not https://wa.me/.
//   mine-tell-seller  <a> INSIDE mine-group-backedout, after its last line, text containing "Tell the seller you backed out",
//                     href = backedOutUrl; absent when null or not https://wa.me/.
//                     Both: target _blank, rel noopener AND noreferrer.
//   Back out  every unit in mine-group-reserved has "backout-open"; the confirmation reuses the booking page's testids
//             (backout-confirm / -yes / -cancel / -status / -error) and its wording ("Yes, back out", "Backing out…").
//             Yes POSTs {action:"backOut", token, claimId} with THAT UNIT'S OWN booking token. On success the page asks
//             `mine` again (the same tokens) and shows the new answer.
//   notFound  tokens the answer lists are removed from the saved list (others keep their order); a failed request, or a
//             busy / error answer, removes nothing.
//   All data via textContent. Tokens only in the hash of #/b/ and in POST bodies.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS } from "../fixtures/catalogue-fixture";
import { hang, json, networkDown } from "./helpers";
import {
  BOOKINGS_KEY, FULL_VIEW, MINE_BACKED_OUT_URL, MINE_WA_URL, OTHER_TOKEN, TOKEN, backOutReply, line, mineReply, seedStorage, setupApi, tok,
  type Json, type Post,
} from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
const hash = (p: Page) => p.evaluate(() => location.hash);
const saved = (p: Page) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as unknown, BOOKINGS_KEY);
const lineFor = (p: Page, group: string, name: string) => t(p, `mine-group-${group}`).getByTestId("mine-line").filter({ hasText: name });
const top = (loc: ReturnType<Page["getByTestId"]>) => loc.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
const bottom = (loc: ReturnType<Page["getByTestId"]>) => loc.evaluate((e) => e.getBoundingClientRect().bottom + window.scrollY);
const both = [OTHER_TOKEN, TOKEN]; // newest first

/** Seeds the saved list and opens #/mine. */
async function openMine(page: Page, handlers: Parameters<typeof setupApi>[1] = {}, list: string[] = both) {
  const api = await setupApi(page, handlers);
  await seedStorage(page, { [BOOKINGS_KEY]: JSON.stringify(list) });
  await page.goto("/#/mine");
  return api;
}
const mines = (api: Awaited<ReturnType<typeof setupApi>>) => api.sent.filter((s) => s.body.action === "mine");

test.describe("the page and its one request", () => {
  test("a direct load posts exactly {action, tokens} once, newest first, in the body, and hides the catalogue", async ({ page }) => {
    const api = await openMine(page);
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    await expect(t(page, "mine-page")).toBeVisible();
    await expect(t(page, "catalogue")).toBeHidden();
    const posts = mines(api);
    expect(posts).toHaveLength(1);
    expect(Object.keys(posts[0]!.body).sort()).toEqual(["action", "tokens"]);
    expect(posts[0]!.body.tokens).toEqual(both);
    expect(posts[0]!.contentType).toContain("text/plain");
    expect(new URL(posts[0]!.url).search).toBe("");
    expect(api.sent.filter((s) => s.body.action === "booking")).toHaveLength(0); // not one request per booking
  });

  test("the address stays #/mine and no token appears in any URL", async ({ page }) => {
    const api = await openMine(page);
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    expect(await hash(page)).toBe("#/mine");
    expect(page.url()).not.toContain(TOKEN);
    expect(page.url()).not.toContain(OTHER_TOKEN);
    for (const s of api.sent) expect(new URL(s.url).search).toBe("");
    for (const u of api.gets) { expect(u).not.toContain(TOKEN); expect(u).not.toContain(OTHER_TOKEN); }
  });

  test("shows a loading note while waiting for the answer", async ({ page }) => {
    await openMine(page, { mine: hang });
    await expect(t(page, "mine-loading")).toBeVisible();
    await expect(t(page, "mine-empty")).toHaveCount(0);
  });

  test("Back to the sale returns to the catalogue", async ({ page }) => {
    await openMine(page);
    await expect(t(page, "mine-back")).toHaveAttribute("href", "#/");
    await t(page, "mine-back").click();
    await expect(t(page, "catalogue")).toBeVisible();
    await expect(t(page, "mine-page")).toBeHidden();
  });

  test("a hash change to #/mine from the catalogue opens it, and the browser Back button returns", async ({ page }) => {
    await setupApi(page);
    await seedStorage(page, { [BOOKINGS_KEY]: JSON.stringify(both) });
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await page.evaluate(() => { location.hash = "#/mine"; });
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    await page.goBack();
    await expect(t(page, "catalogue")).toBeVisible();
  });

  test("#/b/<token> still opens the single booking page", async ({ page }) => {
    await setupApi(page);
    await seedStorage(page, { [BOOKINGS_KEY]: JSON.stringify(both) });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    await expect(t(page, "mine-page")).toBeHidden();
  });
});

test.describe("the header link", () => {
  test("goes to #/mine from the catalogue, and there is a single link (no per-booking list)", async ({ page }) => {
    await setupApi(page);
    await seedStorage(page, { [BOOKINGS_KEY]: JSON.stringify(both) });
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    const link = t(page, "my-reservations");
    await expect(link).toHaveAttribute("href", "#/mine");
    await expect(t(page, "my-reservations-item")).toHaveCount(0);
    await link.click();
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    expect(await hash(page)).toBe("#/mine");
  });

  test("also goes to #/mine from a booking page", async ({ page }) => {
    await setupApi(page);
    await seedStorage(page, { [BOOKINGS_KEY]: JSON.stringify([TOKEN]) });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-reserved")).toBeVisible();
    await expect(t(page, "my-reservations")).toHaveAttribute("href", "#/mine");
  });

  test("shows with a single saved booking too, and not at all once the list is emptied", async ({ page }) => {
    await setupApi(page);
    await seedStorage(page, { [BOOKINGS_KEY]: JSON.stringify([TOKEN]) });
    await page.goto("/");
    await expect(t(page, "my-reservations")).toHaveAttribute("href", "#/mine");
    await page.evaluate((k) => localStorage.setItem(k, "[]"), BOOKINGS_KEY);
    await page.reload();
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await expect(t(page, "my-reservations")).toHaveCount(0);
  });
});

test.describe("the sections", () => {
  test("Reserved holds the held lines and the waiting lines of every booking, each with its quantity or position", async ({ page }) => {
    await openMine(page);
    const reserved = t(page, "mine-group-reserved");
    await expect(reserved.getByRole("heading", { name: "Reserved" })).toBeVisible();
    await expect(reserved.getByTestId("mine-line")).toHaveCount(3);
    await expect(lineFor(page, "reserved", "Test Picture Frame")).toContainText("Test Picture Frame × 2");
    await expect(lineFor(page, "reserved", "Test Picture Frame")).toContainText("Framecraft");
    await expect(lineFor(page, "reserved", "Test Mug")).toBeVisible();
    await expect(lineFor(page, "reserved", "Test Mug")).not.toContainText("×"); // a quantity of 1 has no "× 1"
    await expect(lineFor(page, "reserved", "Test Lamp")).toContainText(/Waiting list position 3/);
  });

  test("Sold to you and Backed out list their own units, and the Fan is not under Reserved", async ({ page }) => {
    await openMine(page);
    await expect(t(page, "mine-group-sold").getByRole("heading", { name: "Sold to you" })).toBeVisible();
    await expect(lineFor(page, "sold", "Test Kettle")).toBeVisible();
    await expect(t(page, "mine-group-backedout").getByRole("heading", { name: "Backed out" })).toBeVisible();
    await expect(lineFor(page, "backedout", "Test Fan")).toBeVisible();
    await expect(lineFor(page, "reserved", "Test Fan")).toHaveCount(0);
    await expect(t(page, "mine-group-reserved").getByTestId("backout-open")).toHaveCount(4); // 2 frames + mug + lamp
    await expect(t(page, "mine-group-sold").getByTestId("backout-open")).toHaveCount(0);
    await expect(t(page, "mine-group-backedout").getByTestId("backout-open")).toHaveCount(0);
  });

  test("come in the order Reserved, Sold to you, Backed out", async ({ page }) => {
    await openMine(page);
    await expect(t(page, "mine-group-backedout")).toBeVisible();
    const a = await top(t(page, "mine-group-reserved")), b = await top(t(page, "mine-group-sold")), c = await top(t(page, "mine-group-backedout"));
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  test("a section with nothing in it is not shown", async ({ page }) => {
    await openMine(page, { mine: (r) => json(mineReply({ sold: [], backedOut: [], backedOutUrl: null }))(r) });
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    await expect(t(page, "mine-group-sold")).toHaveCount(0);
    await expect(t(page, "mine-group-backedout")).toHaveCount(0);
    await expect(t(page, "mine-tell-seller")).toHaveCount(0);
  });

  test("with nothing reserved, only the sold and backed-out sections show, and no Send the details button", async ({ page }) => {
    await openMine(page, { mine: (r) => json(mineReply({ reserved: [], waiting: [], whatsappUrl: null }))(r) });
    await expect(t(page, "mine-group-sold")).toBeVisible();
    await expect(t(page, "mine-group-reserved")).toHaveCount(0);
    await expect(t(page, "mine-whatsapp")).toHaveCount(0);
  });

  test("shows names and brands as text, never as markup", async ({ page }) => {
    const evil = "<img src=x onerror=window.__pwned=1>";
    await openMine(page, { mine: (r) => json(mineReply({ reserved: [tok(TOKEN, line("I-9101", evil, [11], "<b>Brand</b>"))] }))(r) });
    await expect(lineFor(page, "reserved", "onerror")).toContainText(evil);
    await expect(t(page, "mine-page").locator("img, b")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

test.describe("one message per section", () => {
  test("Send the details to the seller sits under the last Reserved line, inside Reserved, and uses whatsappUrl", async ({ page }) => {
    await openMine(page);
    const wa = t(page, "mine-group-reserved").getByTestId("mine-whatsapp");
    await expect(wa).toContainText("Send the details to the seller");
    await expect(wa).toHaveAttribute("href", MINE_WA_URL);
    await expect(wa).toHaveAttribute("target", "_blank");
    await expect(wa).toHaveAttribute("rel", /noopener/);
    await expect(wa).toHaveAttribute("rel", /noreferrer/);
    expect(await top(wa)).toBeGreaterThanOrEqual(await bottom(t(page, "mine-group-reserved").getByTestId("mine-line").last()));
    await expect(t(page, "mine-whatsapp")).toHaveCount(1);
  });

  test("Tell the seller you backed out sits under the last Backed out line, inside Backed out, and uses backedOutUrl", async ({ page }) => {
    await openMine(page);
    const tell = t(page, "mine-group-backedout").getByTestId("mine-tell-seller");
    await expect(tell).toContainText("Tell the seller you backed out");
    await expect(tell).toHaveAttribute("href", MINE_BACKED_OUT_URL);
    await expect(tell).toHaveAttribute("target", "_blank");
    await expect(tell).toHaveAttribute("rel", /noopener/);
    await expect(tell).toHaveAttribute("rel", /noreferrer/);
    expect(await top(tell)).toBeGreaterThanOrEqual(await bottom(t(page, "mine-group-backedout").getByTestId("mine-line").last()));
    await expect(t(page, "mine-tell-seller")).toHaveCount(1);
  });

  test("each button is left out when its link is null, or is not a wa.me link", async ({ page }) => {
    await openMine(page, { mine: (r) => json(mineReply({ whatsappUrl: null, backedOutUrl: "https://evil.invalid/x" }))(r) });
    await expect(t(page, "mine-group-backedout")).toBeVisible();
    await expect(t(page, "mine-whatsapp")).toHaveCount(0);
    await expect(t(page, "mine-tell-seller")).toHaveCount(0);
  });
});

test.describe("saved list edge cases", () => {
  test("with nothing saved the page says so and sends no request", async ({ page }) => {
    const api = await setupApi(page);
    await page.goto("/#/mine");
    await expect(t(page, "mine-empty")).toHaveText(/no saved reservations/i);
    await expect(t(page, "mine-group-reserved")).toHaveCount(0);
    expect(mines(api)).toHaveLength(0);
  });

  for (const [label, value] of [["not JSON", "not json"], ["an object", "{}"], ["numbers", "[5]"], ["empty strings", '[""]'], ["null", "null"]] as const) {
    test(`corrupt saved list (${label}): says there are no saved reservations, sends no request, does not crash`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const api = await setupApi(page);
      await seedStorage(page, { [BOOKINGS_KEY]: value });
      await page.goto("/#/mine");
      await expect(t(page, "mine-empty")).toHaveText(/no saved reservations/i);
      expect(mines(api)).toHaveLength(0);
      expect(errors).toEqual([]);
    });
  }

  test("junk among valid tokens is skipped; only the valid tokens are asked about", async ({ page }) => {
    const api = await openMine(page, {}, [5, TOKEN, ""] as unknown as string[]);
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    expect(mines(api)[0]!.body.tokens).toEqual([TOKEN]);
  });

  test("blocked storage: no crash, the page says there are no saved reservations, no request", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const api = await setupApi(page);
    await page.addInitScript(() => {
      const boom = (): never => { throw new DOMException("blocked", "SecurityError"); };
      for (const m of ["getItem", "setItem", "removeItem", "clear", "key"] as const) Storage.prototype[m] = boom;
    });
    await page.goto("/#/mine");
    await expect(t(page, "mine-empty")).toHaveText(/no saved reservations/i);
    await expect(t(page, "mine-details")).toHaveCount(0);
    expect(mines(api)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test("asks about at most 20 tokens (the 20 newest) and leaves the rest of the saved list alone", async ({ page }) => {
    const many = Array.from({ length: 25 }, (_, i) => `saved-token-${String(i).padStart(2, "0")}`);
    const api = await openMine(page, { mine: (r) => json(mineReply())(r) }, many);
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    expect(mines(api)).toHaveLength(1);
    expect(mines(api)[0]!.body.tokens).toEqual(many.slice(0, 20));
    expect(await saved(page)).toEqual(many);
  });
});

test.describe("not-found tokens are dropped from the saved list", () => {
  test("a token in notFound leaves the list; the others keep their order; the found ones still show", async ({ page }) => {
    const gone = "gone-token-0000";
    await openMine(page, { mine: (r) => json(mineReply({ notFound: [gone] }))(r) }, [OTHER_TOKEN, gone, TOKEN]);
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    await expect.poll(() => saved(page)).toEqual([OTHER_TOKEN, TOKEN]);
  });

  test("when every token is not found the page says no saved reservations, and the header link goes", async ({ page }) => {
    await openMine(page, { mine: (r) => json({ ok: true, reserved: [], waiting: [], sold: [], backedOut: [], notFound: both, whatsappUrl: null, backedOutUrl: null })(r) });
    await expect(t(page, "mine-empty")).toHaveText(/no saved reservations/i);
    await expect.poll(() => saved(page)).toEqual([]);
    await t(page, "mine-back").click();
    await expect(t(page, "catalogue")).toBeVisible();
    await expect(t(page, "my-reservations")).toHaveCount(0);
  });

  test("a notFound token that was never saved changes nothing", async ({ page }) => {
    await openMine(page, { mine: (r) => json(mineReply({ notFound: ["never-saved-0000"] }))(r) });
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    await page.waitForTimeout(200);
    expect(await saved(page)).toEqual(both);
  });

  for (const [what, handler] of [
    ["a network failure", networkDown],
    ["a busy answer", (r) => json({ ok: false, error: "busy" })(r)],
    ["an invalid-request answer", (r) => json({ ok: false, error: "invalid-request" })(r)],
    ["an unavailable answer", (r) => json({ error: "unavailable" })(r)],
  ] as Array<[string, Post]>) {
    test(`${what} shows a retryable error and removes nothing from the list`, async ({ page }) => {
      const api = await openMine(page, { mine: handler });
      await expect(t(page, "mine-error")).toBeVisible();
      await expect(t(page, "mine-error")).toHaveAttribute("role", "alert");
      await expect(t(page, "mine-empty")).toHaveCount(0);
      await page.waitForTimeout(200);
      expect(await saved(page)).toEqual(both);
      api.on("mine", (r) => json(mineReply())(r));
      await t(page, "mine-retry").click();
      await expect(t(page, "mine-group-reserved")).toBeVisible();
      await expect(t(page, "mine-error")).toHaveCount(0);
      expect(mines(api)).toHaveLength(2);
    });
  }
});

test.describe("Back out from the merged view", () => {
  const AFTER = mineReply({
    reserved: [tok(TOKEN, line("I-9101", "Test Picture Frame", [11, 12], "Framecraft"))],
    backedOut: [tok(OTHER_TOKEN, line("I-9103", "Test Fan", [16])), tok(OTHER_TOKEN, line("I-9105", "Test Mug", [17]))],
  });
  const ERROR_COPY = "Couldn't back out just now. Please try again in a moment.";

  /** A `backOut` answered by hand, so the moment of waiting can be looked at. */
  function gated(reply: Json | "network-down"): { handler: Post; answer: () => void } {
    let release: () => void = () => undefined;
    const opened = new Promise<void>((r) => { release = r; });
    return { answer: () => release(), handler: async (route) => { await opened; return reply === "network-down" ? networkDown(route) : json(reply)(route); } };
  }

  test("the Mug (a different booking) is sent with the Mug's own token and claim id, and nobody else's", async ({ page }) => {
    const api = await openMine(page, { backOut: (r) => json(backOutReply(FULL_VIEW))(r) });
    await lineFor(page, "reserved", "Test Mug").getByTestId("backout-open").click();
    await expect(t(page, "backout-confirm")).toContainText("Test Mug");
    await t(page, "backout-yes").click();
    await expect.poll(() => api.sent.filter((s) => s.body.action === "backOut").length).toBe(1);
    const sent = api.sent.find((s) => s.body.action === "backOut")!;
    expect(sent.body).toEqual({ action: "backOut", token: OTHER_TOKEN, claimId: 17 });
    expect(sent.contentType).toContain("text/plain");
    expect(new URL(sent.url).search).toBe("");
  });

  test("the second Frame unit is sent with the Frame's booking token and ITS claim id", async ({ page }) => {
    const api = await openMine(page, { backOut: (r) => json(backOutReply(FULL_VIEW))(r) });
    await lineFor(page, "reserved", "Test Picture Frame").getByTestId("backout-open").nth(1).click();
    await t(page, "backout-yes").click();
    await expect.poll(() => api.sent.filter((s) => s.body.action === "backOut").length).toBe(1);
    expect(api.sent.find((s) => s.body.action === "backOut")!.body).toEqual({ action: "backOut", token: TOKEN, claimId: 12 });
  });

  test("a waiting unit is backed out with its own token and claim id too", async ({ page }) => {
    const api = await openMine(page, { backOut: (r) => json(backOutReply(FULL_VIEW))(r) });
    await lineFor(page, "reserved", "Test Lamp").getByTestId("backout-open").click();
    await t(page, "backout-yes").click();
    await expect.poll(() => api.sent.filter((s) => s.body.action === "backOut").length).toBe(1);
    expect(api.sent.find((s) => s.body.action === "backOut")!.body).toEqual({ action: "backOut", token: TOKEN, claimId: 13 });
  });

  test("Cancel closes the confirmation and sends nothing", async ({ page }) => {
    const api = await openMine(page);
    await lineFor(page, "reserved", "Test Mug").getByTestId("backout-open").click();
    await expect(t(page, "backout-confirm")).toBeVisible();
    await t(page, "backout-cancel").click();
    await expect(t(page, "backout-confirm")).toHaveCount(0);
    expect(api.sent.filter((s) => s.body.action === "backOut")).toHaveLength(0);
  });

  test("while waiting: Yes reads 'Backing out…' and is disabled, Cancel is disabled, a live status shows", async ({ page }) => {
    const g = gated(backOutReply(FULL_VIEW));
    await openMine(page, { backOut: g.handler });
    await lineFor(page, "reserved", "Test Mug").getByTestId("backout-open").click();
    await expect(t(page, "backout-yes")).toHaveText("Yes, back out");
    await t(page, "backout-yes").click();
    await expect(t(page, "backout-yes")).toHaveText("Backing out…");
    await expect(t(page, "backout-yes")).toBeDisabled();
    await expect(t(page, "backout-cancel")).toBeDisabled();
    await expect(t(page, "backout-status")).toContainText("Backing out");
    expect(await t(page, "backout-status").evaluate((e) => !!e.closest('[aria-live], [role="status"], [role="alert"]'))).toBe(true);
    g.answer();
  });

  test("on success the page asks `mine` again with the same tokens and shows the new answer (Mug under Backed out)", async ({ page }) => {
    const g = gated(backOutReply(FULL_VIEW));
    let calls = 0;
    const api = await openMine(page, { backOut: g.handler, mine: (r) => json(++calls === 1 ? mineReply() : AFTER)(r) });
    await lineFor(page, "reserved", "Test Mug").getByTestId("backout-open").click();
    await t(page, "backout-yes").click();
    g.answer();
    await expect(lineFor(page, "backedout", "Test Mug")).toBeVisible();
    await expect(lineFor(page, "reserved", "Test Mug")).toHaveCount(0);
    await expect(t(page, "backout-confirm")).toHaveCount(0);
    await expect(t(page, "backout-status")).toHaveCount(0);
    expect(mines(api)).toHaveLength(2);
    expect(mines(api)[1]!.body.tokens).toEqual(both);
  });

  for (const [what, reply] of [["a refusal", { ok: false, error: "busy" } as Json], ["a network failure", "network-down" as const]] as const) {
    test(`${what}: the error copy shows, Yes is enabled again, nothing moves, and the list is still asked once`, async ({ page }) => {
      const g = gated(reply);
      const api = await openMine(page, { backOut: g.handler });
      await lineFor(page, "reserved", "Test Mug").getByTestId("backout-open").click();
      await t(page, "backout-yes").click();
      g.answer();
      await expect(t(page, "backout-error")).toHaveText(ERROR_COPY);
      await expect(t(page, "backout-yes")).toHaveText("Yes, back out");
      await expect(t(page, "backout-yes")).toBeEnabled();
      await expect(t(page, "backout-status")).toHaveCount(0);
      await expect(lineFor(page, "reserved", "Test Mug")).toBeVisible();
      expect(mines(api)).toHaveLength(1);
      expect(await saved(page)).toEqual(both);
    });
  }
});
