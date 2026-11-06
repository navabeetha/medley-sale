// S-14 back-out on the booking page (brief 2.7, 4.3, 6.1 rules 3, 5, 6, 8, 6.4; D-010; T-02, T-04, T-05). Written
// BEFORE the code: every test must fail on the current site. API mocked; synthetic data only. The server decides who
// is promoted and what the seller is told; these tests pin what the page asks and shows. WhatsApp URLs are only
// asserted, never opened.
//
// DOM CONTRACT pinned here (data-testid), on the booking page of S-12 (see booking-page.spec.ts):
//   Units       every unit of a Reserved line and every Waiting line has its own "backout-open" button (a line
//               "Test Picture Frame × 2" has two). Sold and Ended lines have none. The button's accessible name
//               starts "Back out" and names the item; at least 44 px tall.
//   Unit        each unit is wrapped in a "booking-unit" element (holding its button and its confirmation).
//   Confirm     "backout-confirm" appears INSIDE that unit (and nowhere else) with exactly the 6.4 copy
//               "Back out of <name>? If you change your mind, you'll rejoin at the end of the line."
//               and two buttons: "backout-yes" and "backout-cancel". Cancel closes it and sends nothing.
//   Request     Yes sends POST {action:"backOut", token, claimId} (claimId a NUMBER, exactly these keys), text/plain,
//               no query string. While pending "backout-yes" is disabled, so a double tap sends once.
//   Success     the page redraws from the reply's `booking` (no other request needed); the confirmation closes.
//               "tell-seller" appears: an <a> to the reply's tellSellerUrl, opening in a new tab (target _blank,
//               rel with noopener), and only when tellSellerUrl is a non-null string. It is absent before a back-out.
//   Failure     {ok:false,...} or a network error: role="alert" "backout-error" in that unit, the units stay as
//               they were, no "tell-seller"; the buyer can press Yes again.
//   Catalogue   after a successful back-out the sale list shows the freed unit (a fresh catalogue is read).
import { test, expect, type Page } from "@playwright/test";
import { item, response } from "../fixtures/catalogue-fixture";
import { hang, json, networkDown } from "./helpers";
import { FULL_VIEW, TELL_URL, TOKEN, backOutReply, line, setupApi, waiting, type Api, type Json } from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
const lineFor = (p: Page, group: string, name: string) =>
  t(p, `booking-group-${group}`).getByTestId("booking-line").filter({ hasText: name });
const FRAME = (p: Page) => lineFor(p, "reserved", "Test Picture Frame");
const COPY = (name: string) => `Back out of ${name}? If you change your mind, you'll rejoin at the end of the line.`;

/** The view after claim 11 (one frame) has gone. */
const AFTER_ONE_FRAME: Json = {
  ...FULL_VIEW,
  reserved: [line("I-9101", "Test Picture Frame", [12]), line("I-9105", "Test Mug", [17])],
  ended: [line("I-9103", "Test Fan", [16]), line("I-9101", "Test Picture Frame", [11])],
};
const backOuts = (api: Api) => api.sent.filter((s) => s.body.action === "backOut");

async function open(page: Page, api?: Partial<Parameters<typeof setupApi>[1]>): Promise<Api> {
  const a = await setupApi(page, api);
  await page.goto(`/#/b/${TOKEN}`);
  await expect(t(page, "booking-group-reserved")).toBeVisible();
  return a;
}

test.describe("per-unit back out and its confirmation", () => {
  test("each held unit and each waiting line has its own Back out button; sold and ended lines have none", async ({ page }) => {
    await open(page);
    await expect(FRAME(page).getByTestId("backout-open")).toHaveCount(2); // two units
    await expect(lineFor(page, "reserved", "Test Mug").getByTestId("backout-open")).toHaveCount(1);
    await expect(lineFor(page, "waiting", "Test Lamp").getByTestId("backout-open")).toHaveCount(1);
    await expect(lineFor(page, "waiting", "Test Radio").getByTestId("backout-open")).toHaveCount(1);
    await expect(t(page, "booking-group-sold").getByTestId("backout-open")).toHaveCount(0);
    await expect(t(page, "booking-group-ended").getByTestId("backout-open")).toHaveCount(0);
    const btn = lineFor(page, "waiting", "Test Lamp").getByTestId("backout-open");
    await expect(btn).toHaveAccessibleName(/^Back out.*Test Lamp/);
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("pressing Back out opens the 6.4 confirmation inside that unit only, and sends nothing yet", async ({ page }) => {
    const api = await open(page);
    await FRAME(page).getByTestId("backout-open").nth(1).click();
    await expect(t(page, "backout-confirm")).toHaveCount(1);
    await expect(FRAME(page).getByTestId("backout-confirm")).toHaveText(new RegExp(COPY("Test Picture Frame").replace(/[?.]/g, "\\$&")));
    await expect(FRAME(page).getByTestId("backout-confirm")).toBeVisible();
    // It sits in the second unit, not the first.
    const where = await FRAME(page).getByTestId("backout-open").evaluateAll((btns) =>
      btns.map((b) => !!(b.closest('[data-testid="booking-unit"]') ?? b.parentElement)?.querySelector('[data-testid="backout-confirm"]')));
    expect(where).toEqual([false, true]);
    expect(backOuts(api)).toHaveLength(0);
  });

  test("the confirmation names the item it is for (a waiting line says its own item)", async ({ page }) => {
    await open(page);
    await lineFor(page, "waiting", "Test Lamp").getByTestId("backout-open").click();
    await expect(t(page, "backout-confirm")).toContainText("Back out of Test Lamp?");
    await expect(t(page, "backout-confirm")).toContainText("you'll rejoin at the end of the line");
  });

  test("Cancel closes the confirmation and sends nothing", async ({ page }) => {
    const api = await open(page);
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-cancel").click();
    await expect(t(page, "backout-confirm")).toHaveCount(0);
    expect(backOuts(api)).toHaveLength(0);
    await expect(FRAME(page)).toHaveText(/×\s*2/);
  });

  test("the confirmation text is shown as text even if the item name is markup", async ({ page }) => {
    const evil = { ...FULL_VIEW, reserved: [line("I-9101", "<i id=\"pwn\">x</i>", [11])] };
    await setupApi(page, { booking: (r) => json({ ok: true, booking: evil, whatsappUrl: null })(r) });
    await page.goto(`/#/b/${TOKEN}`);
    await t(page, "booking-group-reserved").getByTestId("backout-open").click();
    await expect(t(page, "backout-confirm")).toContainText('<i id="pwn">x</i>');
    await expect(page.locator("#pwn")).toHaveCount(0);
  });
});

test.describe("sending the back-out", () => {
  test("Yes sends exactly {action, token, claimId} for that unit, in the body only", async ({ page }) => {
    const api = await open(page, { backOut: (r) => json(backOutReply(AFTER_ONE_FRAME))(r) });
    await FRAME(page).getByTestId("backout-open").nth(1).click(); // the second frame is claim 12
    await t(page, "backout-yes").click();
    await expect.poll(() => backOuts(api).length).toBe(1);
    const sent = backOuts(api)[0]!;
    expect(Object.keys(sent.body).sort()).toEqual(["action", "claimId", "token"]);
    expect(sent.body.token).toBe(TOKEN);
    expect(sent.body.claimId).toBe(12); // a number, not "12"
    expect(sent.contentType).toMatch(/^text\/plain/);
    expect(new URL(sent.url).search).toBe("");
    expect(sent.url).not.toContain(TOKEN);
  });

  test("a waiting line sends its own claim ID", async ({ page }) => {
    const api = await open(page, { backOut: (r) => json(backOutReply(FULL_VIEW))(r) });
    await lineFor(page, "waiting", "Test Radio").getByTestId("backout-open").click();
    await t(page, "backout-yes").click();
    await expect.poll(() => backOuts(api).length).toBe(1);
    expect(backOuts(api)[0]!.body.claimId).toBe(14);
  });

  test("on success the page redraws from the reply: one frame left, one more ended; confirmation closed", async ({ page }) => {
    const api = await open(page, { backOut: (r) => json(backOutReply(AFTER_ONE_FRAME))(r) });
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-yes").click();
    await expect(FRAME(page)).not.toHaveText(/×/); // now a single unit
    await expect(FRAME(page).getByTestId("backout-open")).toHaveCount(1);
    await expect(lineFor(page, "ended", "Test Picture Frame")).toBeVisible();
    await expect(t(page, "backout-confirm")).toHaveCount(0);
    expect(api.sent.filter((s) => s.body.action === "booking")).toHaveLength(1); // no second fetch of the booking
  });

  test("a waiter leaving moves the others up in the redrawn list (positions come from the reply)", async ({ page }) => {
    const after = { ...FULL_VIEW, waiting: [waiting(14, "I-9102", "Test Radio", 1, true), waiting(18, "I-9002", "Test Lamp", 2)] };
    await open(page, { backOut: (r) => json(backOutReply(after))(r) });
    await lineFor(page, "waiting", "Test Lamp").getByTestId("backout-open").click();
    await t(page, "backout-yes").click();
    await expect(lineFor(page, "waiting", "Test Lamp")).toHaveText(/position 2\b/i);
  });

  test("a double tap on Yes sends once, and Yes is disabled while pending", async ({ page }) => {
    const api = await open(page, { backOut: hang });
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-yes").dblclick();
    await expect(t(page, "backout-yes")).toBeDisabled();
    await page.waitForTimeout(200);
    expect(backOuts(api)).toHaveLength(1);
  });

  test("a repeated back-out of an already-ended unit (server answers ok) shows no error", async ({ page }) => {
    // The server treats a repeat as ok and changes nothing (acceptance: no error, no second promotion).
    await open(page, { backOut: (r) => json(backOutReply(AFTER_ONE_FRAME))(r) });
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-yes").click();
    await expect(lineFor(page, "ended", "Test Picture Frame")).toBeVisible();
    await expect(t(page, "backout-error")).toHaveCount(0);
  });
});

test.describe("Tell the seller", () => {
  test("is absent before a back-out", async ({ page }) => {
    await open(page);
    await expect(t(page, "tell-seller")).toHaveCount(0);
  });

  test("after a back-out it links to the reply's tellSellerUrl in a new tab, without being opened", async ({ page }) => {
    await open(page, { backOut: (r) => json(backOutReply(AFTER_ONE_FRAME))(r) });
    const popups: unknown[] = [];
    page.on("popup", (p) => popups.push(p));
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-yes").click();
    const a = t(page, "tell-seller");
    await expect(a).toBeVisible();
    await expect(a).toHaveText(/Tell the seller/i);
    await expect(a).toHaveAttribute("href", TELL_URL);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
    expect(await a.getAttribute("href")).toMatch(/^https:\/\/wa\.me\//);
    expect(popups).toHaveLength(0); // it is an offer, never opened for the buyer
  });

  test("no link when the reply has no tellSellerUrl", async ({ page }) => {
    await open(page, { backOut: (r) => json(backOutReply(AFTER_ONE_FRAME, null))(r) });
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-yes").click();
    await expect(lineFor(page, "ended", "Test Picture Frame")).toBeVisible();
    await expect(t(page, "tell-seller")).toHaveCount(0);
  });

  test("a tellSellerUrl that is not a wa.me link is never used as a link", async ({ page }) => {
    await open(page, { backOut: (r) => json(backOutReply(AFTER_ONE_FRAME, "javascript:alert(1)"))(r) });
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-yes").click();
    await expect(lineFor(page, "ended", "Test Picture Frame")).toBeVisible();
    await expect(t(page, "tell-seller")).toHaveCount(0);
  });
});

test.describe("failures", () => {
  const FAILS: [string, (a: Page) => Parameters<typeof setupApi>[1]][] = [
    ["not-allowed", () => ({ backOut: (r) => json({ ok: false, error: "not-allowed" })(r) })],
    ["busy", () => ({ backOut: (r) => json({ ok: false, error: "busy" })(r) })],
    ["not-found", () => ({ backOut: (r) => json({ ok: false, error: "not-found" })(r) })],
    ["a network failure", () => ({ backOut: networkDown })],
  ];
  for (const [what, mk] of FAILS) {
    test(`${what}: an alert in the unit, the list unchanged, no Tell the seller`, async ({ page }) => {
      await open(page, mk(page));
      await FRAME(page).getByTestId("backout-open").first().click();
      await t(page, "backout-yes").click();
      const alert = t(page, "backout-error");
      await expect(alert).toBeVisible();
      await expect(alert).toHaveAttribute("role", "alert");
      await expect(alert).not.toHaveText(/not-allowed|not-found|\bbusy\b.*error|undefined/i); // words, not codes
      await expect(FRAME(page)).toHaveText(/×\s*2/);
      await expect(t(page, "tell-seller")).toHaveCount(0);
      await expect(t(page, "backout-yes")).toBeEnabled(); // the buyer can try again
    });
  }

  test("after a busy answer, pressing Yes again goes through", async ({ page }) => {
    let busy = true;
    const api = await open(page, { backOut: (r) => json(busy ? { ok: false, error: "busy" } : backOutReply(AFTER_ONE_FRAME))(r) });
    await FRAME(page).getByTestId("backout-open").first().click();
    await t(page, "backout-yes").click();
    await expect(t(page, "backout-error")).toBeVisible();
    busy = false;
    await t(page, "backout-yes").click();
    await expect(lineFor(page, "ended", "Test Picture Frame")).toBeVisible();
    await expect(t(page, "backout-error")).toHaveCount(0);
    expect(backOuts(api)).toHaveLength(2);
  });
});

test.describe("the catalogue updates", () => {
  test("after a holder backs out, the sale list shows the freed unit", async ({ page }) => {
    const held = item({ id: "I-9001", name: "Test Kettle", freeUnits: 0, unitsLeft: 1, waitingCount: 0 });
    const freed = item({ id: "I-9001", name: "Test Kettle", freeUnits: 1, unitsLeft: 1, waitingCount: 0 });
    const view = { ...FULL_VIEW, reserved: [line("I-9001", "Test Kettle", [21])], waiting: [], sold: [], ended: [] };
    const done = { ...view, reserved: [], ended: [line("I-9001", "Test Kettle", [21])] };
    const api = await setupApi(page, {
      booking: (r) => json({ ok: true, booking: view, whatsappUrl: null })(r),
      backOut: (r) => { api.setCatalogue({ ...response([freed]), reserving: true }); return json(backOutReply(done))(r); },
    }, { ...response([held]), reserving: true });
    await page.goto(`/#/b/${TOKEN}`);
    await t(page, "backout-open").click();
    await t(page, "backout-yes").click();
    await expect(lineFor(page, "ended", "Test Kettle")).toBeVisible();
    await t(page, "booking-back").click();
    // Free now: the card offers "Add", not "Join waiting list".
    await expect(t(page, "add-button")).toHaveText(/^Add$/);
  });
});
