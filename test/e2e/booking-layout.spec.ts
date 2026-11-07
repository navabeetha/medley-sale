// G1 (the seller, 2026-11-07): "the tell the seller you backed out is below the send details to seller button. Can we move
// the message back out button under the Ended section? ... one message about all the stuff you reserved and another for all
// you backed out, each in their sections." Red step: written before the code. API mocked; WhatsApp URLs only asserted.
//
// DOM CONTRACT pinned here:
//   booking-whatsapp  "Send the details to the seller on WhatsApp": in the Reserved/Waiting part of the page, after the last
//                     Reserved or Waiting unit and before the Sold and Ended sections. Uses the reply's whatsappUrl.
//   tell-seller       "Tell the seller you backed out": INSIDE the "booking-group-ended" section, after its units. Uses the
//                     reply's `backedOutUrl` (never tellSellerUrl). Shown on page load whenever backedOutUrl is a non-null
//                     https://wa.me/ string, not only right after a back-out; absent otherwise.
//   Both links: target _blank, rel containing noopener AND noreferrer (S-17 gap), href only ever an https://wa.me/ URL.
import { test, expect, type Page } from "@playwright/test";
import { json } from "./helpers";
import { BACKED_OUT_URL, FULL_VIEW, TOKEN, WA_URL, backOutReply, bookingReply, line, setupApi, waiting, type Json } from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
async function openWith(page: Page, whatsappUrl: string | null, backedOutUrl: string | null, view: Json = FULL_VIEW) {
  const api = await setupApi(page, { booking: (r) => json(bookingReply(view, whatsappUrl, backedOutUrl))(r) });
  await page.goto(`/#/b/${TOKEN}`);
  await expect(t(page, "booking-group-ended")).toBeVisible();
  return api;
}
/** Bottom edge (px from the top of the page) of an element. */
const bottom = async (loc: ReturnType<Page["getByTestId"]>) => (await loc.evaluate((e) => e.getBoundingClientRect().bottom + window.scrollY));
const top = async (loc: ReturnType<Page["getByTestId"]>) => (await loc.evaluate((e) => e.getBoundingClientRect().top + window.scrollY));

test.describe("Send the details to the seller (Reserved / Waiting)", () => {
  test("sits after the last Reserved and Waiting unit and above the Sold and Ended sections", async ({ page }) => {
    await openWith(page, WA_URL, BACKED_OUT_URL);
    const wa = t(page, "booking-whatsapp");
    await expect(wa).toBeVisible();
    const lastWaiting = t(page, "booking-group-waiting").getByTestId("booking-line").last();
    expect(await top(wa)).toBeGreaterThanOrEqual(await bottom(lastWaiting));
    expect(await bottom(wa)).toBeLessThanOrEqual(await top(t(page, "booking-group-sold")));
    expect(await bottom(wa)).toBeLessThanOrEqual(await top(t(page, "booking-group-ended")));
  });

  test("with only waiting lines it still comes after them", async ({ page }) => {
    const view = { ...FULL_VIEW, reserved: [], waiting: [waiting(13, "I-9002", "Test Lamp", 3)] };
    await openWith(page, WA_URL, BACKED_OUT_URL, view);
    expect(await top(t(page, "booking-whatsapp"))).toBeGreaterThanOrEqual(await bottom(t(page, "booking-group-waiting").getByTestId("booking-line").last()));
  });

  test("is not inside the Ended section", async ({ page }) => {
    await openWith(page, WA_URL, BACKED_OUT_URL);
    await expect(t(page, "booking-group-ended").getByTestId("booking-whatsapp")).toHaveCount(0);
  });

  test("opens in a new tab with rel noopener noreferrer", async ({ page }) => {
    await openWith(page, WA_URL, null);
    const a = t(page, "booking-whatsapp");
    await expect(a).toHaveAttribute("href", WA_URL);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
    await expect(a).toHaveAttribute("rel", /noreferrer/);
  });
});

test.describe("Tell the seller you backed out (Ended)", () => {
  test("is inside the Ended section, after every unit in it", async ({ page }) => {
    await openWith(page, WA_URL, BACKED_OUT_URL);
    const a = t(page, "booking-group-ended").getByTestId("tell-seller");
    await expect(a).toBeVisible();
    await expect(a).toHaveText("Tell the seller you backed out");
    const last = t(page, "booking-group-ended").getByTestId("booking-line").last();
    expect(await top(a)).toBeGreaterThanOrEqual(await bottom(last));
    // Also after it in the document, so a screen reader meets the units first.
    const after = await a.evaluate((el) => {
      const lines = el.closest('[data-testid="booking-group-ended"]')!.querySelectorAll('[data-testid="booking-line"]');
      return lines[lines.length - 1]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(after).toBeTruthy();
  });

  test("is below the details link, not beside it (they are in different sections)", async ({ page }) => {
    await openWith(page, WA_URL, BACKED_OUT_URL);
    await expect(t(page, "tell-seller")).toBeVisible();
    expect(await top(t(page, "tell-seller"))).toBeGreaterThan(await bottom(t(page, "booking-whatsapp")));
  });

  test("shows on page load when backedOutUrl is set, with no back-out in this visit, and opens in a new tab safely", async ({ page }) => {
    await openWith(page, WA_URL, BACKED_OUT_URL);
    const a = t(page, "tell-seller");
    await expect(a).toHaveAttribute("href", BACKED_OUT_URL);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
    await expect(a).toHaveAttribute("rel", /noreferrer/);
  });

  test("is absent when backedOutUrl is null, even though the Ended section has units", async ({ page }) => {
    await openWith(page, WA_URL, null);
    await expect(t(page, "booking-group-ended")).toBeVisible();
    await expect(t(page, "tell-seller")).toHaveCount(0);
  });

  test("is absent when the booking reply has no backedOutUrl key at all (an older server)", async ({ page }) => {
    await setupApi(page, { booking: (r) => json({ ok: true, booking: FULL_VIEW, whatsappUrl: WA_URL })(r) });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-group-ended")).toBeVisible();
    await expect(t(page, "tell-seller")).toHaveCount(0);
  });

  test("only an https://wa.me/ backedOutUrl is ever used as a link", async ({ page }) => {
    for (const url of ["javascript:alert(1)", "https://example.com/?text=x", "http://wa.me/919000000001?text=x", "https://wa.me.example.invalid/x"]) {
      const p = await page.context().newPage();
      await openWith(p, WA_URL, url);
      await expect(t(p, "tell-seller"), url).toHaveCount(0);
      await p.close();
    }
  });

  test("a tellSellerUrl alone (backedOutUrl null) in a back-out reply does not bring the link back", async ({ page }) => {
    await setupApi(page, { backOut: (r) => json(backOutReply(FULL_VIEW, null))(r) });
    await page.goto(`/#/b/${TOKEN}`);
    await t(page, "backout-open").first().click();
    await t(page, "backout-yes").click();
    await expect(t(page, "backout-confirm")).toHaveCount(0);
    await expect(t(page, "tell-seller")).toHaveCount(0);
  });

  test("a back-out reply replaces both links with its updated URLs", async ({ page }) => {
    const NEW_WA = "https://wa.me/919000000001?text=updated-details";
    const NEW_BACKED = "https://wa.me/919000000001?text=updated-backed-out";
    const after = { ...FULL_VIEW, reserved: [line("I-9101", "Test Picture Frame", [12]), line("I-9105", "Test Mug", [17])], ended: [line("I-9103", "Test Fan", [16]), line("I-9101", "Test Picture Frame", [11])] };
    await setupApi(page, {
      booking: (r) => json(bookingReply(FULL_VIEW, WA_URL, BACKED_OUT_URL))(r),
      backOut: (r) => json(backOutReply(after, NEW_BACKED, NEW_WA))(r),
    });
    await page.goto(`/#/b/${TOKEN}`);
    await t(page, "booking-group-reserved").getByTestId("backout-open").first().click();
    await t(page, "backout-yes").click();
    await expect(t(page, "tell-seller")).toHaveAttribute("href", NEW_BACKED);
    await expect(t(page, "booking-whatsapp")).toHaveAttribute("href", NEW_WA); // pins today's behaviour, now the mock matches the real API
  });

  test("backing out the last active unit drops the details link but keeps the backed-out one", async ({ page }) => {
    const view = { ...FULL_VIEW, reserved: [line("I-9105", "Test Mug", [17])], waiting: [], sold: [], ended: [] };
    const done = { ...view, reserved: [], ended: [line("I-9105", "Test Mug", [17])] };
    await setupApi(page, {
      booking: (r) => json(bookingReply(view, WA_URL, null))(r),
      backOut: (r) => json(backOutReply(done, BACKED_OUT_URL, null))(r),
    });
    await page.goto(`/#/b/${TOKEN}`);
    await expect(t(page, "booking-whatsapp")).toBeVisible();
    await t(page, "backout-open").click();
    await t(page, "backout-yes").click();
    await expect(t(page, "booking-group-ended").getByTestId("tell-seller")).toBeVisible();
    await expect(t(page, "booking-whatsapp")).toHaveCount(0);
  });

  test("tapping it sends no waOpened (that counts only the details link)", async ({ page }) => {
    await page.context().route(/^https:\/\/wa\.me\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>x</p>" }));
    const api = await openWith(page, WA_URL, BACKED_OUT_URL);
    const [tab] = await Promise.all([page.context().waitForEvent("page", { timeout: 3000 }), t(page, "tell-seller").click()]);
    await tab.close();
    await page.waitForTimeout(300);
    expect(api.sent.filter((s) => s.body.action === "waOpened")).toHaveLength(0);
  });
});
