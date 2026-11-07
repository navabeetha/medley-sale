// G1 (the seller, on her phone): "there is no feedback to know if I pressed the 'yes, back out' button, so no way of knowing
// when to stop tapping." Red step: every pending-state test must fail on the current site.
//
// DOM CONTRACT pinned here, on top of back-out.spec.ts:
//   While a back-out is waiting for its reply:
//     "backout-yes"     reads "Backing out…" (with the ellipsis character) and is disabled.
//     "backout-cancel"  is disabled (S-17 carried note: Cancel must not close a request in flight).
//     "backout-status"  visible text in the confirmation, containing "Backing out", inside an aria-live region
//                       (the element itself, or an ancestor, has aria-live="polite" or "assertive", or role="status"/"alert").
//   Before Yes is pressed: "backout-yes" reads "Yes, back out", and there is no "backout-status".
//   On success: the unit shows Ended (no confirmation, no status text left).
//   On failure: the existing error copy shows, "backout-yes" reads "Yes, back out" again and is enabled, Cancel is enabled,
//               and the status text is gone.
import { test, expect, type Page } from "@playwright/test";
import { json, networkDown } from "./helpers";
import { FULL_VIEW, TOKEN, backOutReply, line, setupApi, type Json, type Post } from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
const FRAME = (p: Page) => t(p, "booking-group-reserved").getByTestId("booking-line").filter({ hasText: "Test Picture Frame" });
const AFTER: Json = {
  ...FULL_VIEW,
  reserved: [line("I-9101", "Test Picture Frame", [12]), line("I-9105", "Test Mug", [17])],
  ended: [line("I-9103", "Test Fan", [16]), line("I-9101", "Test Picture Frame", [11])],
};
const ERROR_COPY = "Couldn't back out just now. Please try again in a moment.";

/** A backOut handler the test answers by hand, so the "waiting for the reply" moment can be looked at. */
function gated(reply: Json | "network-down"): { handler: Post; answer: () => void } {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((r) => { release = r; });
  return {
    answer: () => release(),
    handler: async (route) => {
      await opened;
      if (reply === "network-down") return networkDown(route);
      return json(reply)(route);
    },
  };
}

async function confirm(page: Page, backOut: Post): Promise<void> {
  await setupApi(page, { backOut });
  await page.goto(`/#/b/${TOKEN}`);
  await FRAME(page).getByTestId("backout-open").first().click();
}

test.describe("while the back-out is waiting for its reply", () => {
  test("before Yes is pressed the button says 'Yes, back out' and there is no status text", async ({ page }) => {
    await confirm(page, gated(backOutReply(AFTER)).handler);
    await expect(t(page, "backout-yes")).toHaveText("Yes, back out");
    await expect(t(page, "backout-yes")).toBeEnabled();
    await expect(t(page, "backout-status")).toHaveCount(0);
  });

  test("Yes becomes 'Backing out…' and is disabled", async ({ page }) => {
    const g = gated(backOutReply(AFTER));
    await confirm(page, g.handler);
    await t(page, "backout-yes").click();
    await expect(t(page, "backout-yes")).toHaveText("Backing out…");
    await expect(t(page, "backout-yes")).toBeDisabled();
    g.answer();
  });

  test("a visible status text appears inside an aria-live region", async ({ page }) => {
    const g = gated(backOutReply(AFTER));
    await confirm(page, g.handler);
    await t(page, "backout-yes").click();
    const status = t(page, "backout-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("Backing out");
    // The element or an ancestor announces changes (aria-live, or the status / alert role that implies it).
    const live = await status.evaluate((el) => !!el.closest('[aria-live="polite"], [aria-live="assertive"], [role="status"], [role="alert"]'));
    expect(live).toBe(true);
    g.answer();
  });

  test("Cancel is disabled, so the buyer cannot close a request that is in flight", async ({ page }) => {
    const g = gated(backOutReply(AFTER));
    await confirm(page, g.handler);
    await t(page, "backout-yes").click();
    await expect(t(page, "backout-cancel")).toBeDisabled();
    await expect(t(page, "backout-confirm")).toBeVisible(); // and the confirmation stays up
    g.answer();
  });
});

test.describe("when the reply arrives", () => {
  test("success: the unit shows Ended, with no confirmation or status text left", async ({ page }) => {
    const g = gated(backOutReply(AFTER));
    await confirm(page, g.handler);
    await t(page, "backout-yes").click();
    await expect(t(page, "backout-status")).toBeVisible();
    g.answer();
    await expect(t(page, "booking-group-ended").getByTestId("booking-line").filter({ hasText: "Test Picture Frame" })).toBeVisible();
    await expect(t(page, "backout-confirm")).toHaveCount(0);
    await expect(t(page, "backout-status")).toHaveCount(0);
    await expect(page.getByText("Backing out")).toHaveCount(0);
  });

  for (const [what, reply] of [
    ["a refusal", { ok: false, error: "busy" } as Json],
    ["a network failure", "network-down" as const],
  ] as const) {
    test(`${what}: the error copy shows, Yes is 'Yes, back out' and enabled again, Cancel works, status text gone`, async ({ page }) => {
      const g = gated(reply);
      await confirm(page, g.handler);
      await t(page, "backout-yes").click();
      await expect(t(page, "backout-yes")).toHaveText("Backing out…");
      g.answer();
      await expect(t(page, "backout-error")).toHaveText(ERROR_COPY);
      await expect(t(page, "backout-yes")).toHaveText("Yes, back out");
      await expect(t(page, "backout-yes")).toBeEnabled();
      await expect(t(page, "backout-cancel")).toBeEnabled();
      await expect(t(page, "backout-status")).toHaveCount(0);
    });
  }

  test("after a failure the buyer can press Yes again and see the pending text again", async ({ page }) => {
    let calls = 0;
    const first = gated({ ok: false, error: "busy" });
    const second = gated(backOutReply(AFTER));
    await confirm(page, (route, sent) => (++calls === 1 ? first.handler(route, sent) : second.handler(route, sent)));
    await t(page, "backout-yes").click();
    first.answer();
    await expect(t(page, "backout-error")).toBeVisible();
    await t(page, "backout-yes").click();
    await expect(t(page, "backout-yes")).toHaveText("Backing out…");
    await expect(t(page, "backout-error")).toHaveCount(0); // the old error is not shown beside the new attempt
    second.answer();
    await expect(t(page, "booking-group-ended").getByTestId("booking-line").filter({ hasText: "Test Picture Frame" })).toBeVisible();
  });
});
