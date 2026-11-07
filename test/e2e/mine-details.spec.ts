// S-19: the "My details" section at the bottom of #/mine, and the Forget button's move off the reserve screen. Red step.
// The seller at G1: "check that removing my details should not wipe the reservations, only remove phone and name."
//
// DOM CONTRACT pinned here (data-testid), on top of mine.spec.ts:
//   mine-details         the section (heading "My details"), AFTER every reservation section, shown only when the remembered
//                        buyer (localStorage medley-sale:buyer:v1, JSON {name, number}, both strings) is readable. Absent
//                        (not just hidden) when nothing is saved, the value is corrupt, or storage is blocked.
//   mine-details-name    the saved name as text.      mine-details-number   the saved number as text (any spacing).
//   mine-forget          <button> "Forget my details", at least 44 px tall. Removes ONLY medley-sale:buyer:v1. The bookings list
//                        (medley-sale:bookings:v1), every other key and the reservations on screen are untouched, and nothing
//                        is sent to the API. The section then disappears.
//   reserve-forget       GONE from the reserve screen, even when details are remembered. The reserve form still fills in the
//                        remembered name and number, and still remembers them after a booking.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS } from "../fixtures/catalogue-fixture";
import {
  BOOKINGS_KEY, BUYER_JSON, BUYER_KEY, BUYER_NAME, OTHER_TOKEN, TOKEN, blockStorage, seedStorage, setupApi,
} from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
const both = JSON.stringify([OTHER_TOKEN, TOKEN]);
const SENTINEL_KEY = "medley-sale:other-setting:v1"; // an unrelated key that Forget must not touch
const raw = (p: Page, key: string) => p.evaluate((k) => localStorage.getItem(k), key);
const top = (loc: ReturnType<Page["getByTestId"]>) => loc.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
const bottom = (loc: ReturnType<Page["getByTestId"]>) => loc.evaluate((e) => e.getBoundingClientRect().bottom + window.scrollY);

async function openMine(page: Page, extra: Record<string, string> = { [BUYER_KEY]: BUYER_JSON }) {
  const api = await setupApi(page);
  await seedStorage(page, { [BOOKINGS_KEY]: both, [SENTINEL_KEY]: "keep-me", ...extra });
  await page.goto("/#/mine");
  await expect(t(page, "mine-group-reserved")).toBeVisible();
  return api;
}

test.describe("the My details section", () => {
  test("shows the saved name and number, under a My details heading", async ({ page }) => {
    await openMine(page);
    const box = t(page, "mine-details");
    await expect(box.getByRole("heading", { name: "My details" })).toBeVisible();
    await expect(t(page, "mine-details-name")).toContainText(BUYER_NAME);
    const digits = ((await t(page, "mine-details-number").textContent()) ?? "").replace(/\D/g, "");
    expect(digits).toContain("9000000012"); // the ten digits of the synthetic number, however they are spaced
    await expect(t(page, "mine-forget")).toHaveText(/Forget my details/);
  });

  test("is the last section: after Reserved, Sold to you and Backed out", async ({ page }) => {
    await openMine(page);
    const d = t(page, "mine-details");
    for (const g of ["reserved", "sold", "backedout"]) expect(await top(d)).toBeGreaterThanOrEqual(await bottom(t(page, `mine-group-${g}`)));
  });

  test("still shows when there are no reservations to list", async ({ page }) => {
    await setupApi(page);
    await seedStorage(page, { [BUYER_KEY]: BUYER_JSON });
    await page.goto("/#/mine");
    await expect(t(page, "mine-empty")).toBeVisible();
    await expect(t(page, "mine-details")).toBeVisible(); // the buyer may still want to clear what the device remembers
  });

  test("shows the name and number as text, never as markup", async ({ page }) => {
    await openMine(page, { [BUYER_KEY]: JSON.stringify({ name: "<i>Asha</i>", number: "<u>x</u>" }) });
    await expect(t(page, "mine-details-name")).toContainText("<i>Asha</i>");
    await expect(t(page, "mine-details").locator("i, u")).toHaveCount(0);
  });

  test("is absent when nothing is remembered", async ({ page }) => {
    await openMine(page, {});
    await expect(t(page, "mine-details")).toHaveCount(0);
    await expect(t(page, "mine-forget")).toHaveCount(0);
  });

  for (const [label, value] of [
    ["not JSON", "not json"], ["an empty object", "{}"], ["null", "null"], ["a name only", JSON.stringify({ name: "Asha Testperson" })],
    ["numbers instead of strings", JSON.stringify({ name: 5, number: 6 })], ["an array", "[]"],
  ] as const) {
    test(`is absent when the remembered buyer is corrupt (${label}), and nothing crashes`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await openMine(page, { [BUYER_KEY]: value });
      await expect(t(page, "mine-details")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("is absent when storage is blocked", async ({ page }) => {
    await blockStorage(page);
    await setupApi(page);
    await page.goto("/#/mine");
    await expect(t(page, "mine-empty")).toBeVisible();
    await expect(t(page, "mine-details")).toHaveCount(0);
  });

  test("Forget is a proper tap target (at least 44 px tall)", async ({ page }) => {
    await openMine(page);
    const box = await t(page, "mine-forget").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });
});

test.describe("Forget my details", () => {
  test("removes only the remembered buyer: the bookings list and every other key stay exactly as they were", async ({ page }) => {
    await openMine(page);
    const before = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    await t(page, "mine-forget").click();
    await expect(t(page, "mine-details")).toHaveCount(0);
    const after = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    expect(after[BUYER_KEY]).toBeUndefined();
    const { [BUYER_KEY]: _gone, ...rest } = before;
    expect(_gone).toBe(BUYER_JSON); // it was there to remove
    expect(after).toEqual(rest);
    expect(await raw(page, BOOKINGS_KEY)).toBe(both); // byte for byte
  });

  test("leaves the reservations on screen untouched: same lines, same buttons, same links, no new request", async ({ page }) => {
    const api = await openMine(page);
    const snapshot = () => page.evaluate(() => {
      const q = (id: string) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
      return {
        lines: q("mine-line").map((e) => e.textContent),
        backOut: q("backout-open").length,
        wa: q("mine-whatsapp").map((e) => e.getAttribute("href")),
        tell: q("mine-tell-seller").map((e) => e.getAttribute("href")),
        groups: ["reserved", "sold", "backedout"].map((g) => q(`mine-group-${g}`).length),
      };
    });
    const before = await snapshot();
    expect(before.lines.length).toBeGreaterThan(0);
    const posts = api.sent.length;
    await t(page, "mine-forget").click();
    await expect(t(page, "mine-details")).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
    await page.waitForTimeout(200);
    expect(api.sent.length).toBe(posts); // forgetting asks the server nothing
  });

  test("after a reload the reservations are still listed and the details stay gone", async ({ page }) => {
    await openMine(page);
    await t(page, "mine-forget").click();
    await page.reload();
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    await expect(t(page, "mine-details")).toHaveCount(0);
  });

  test("the header link still shows afterwards, because the bookings list is still there", async ({ page }) => {
    await openMine(page);
    await t(page, "mine-forget").click();
    await t(page, "mine-back").click();
    await expect(t(page, "my-reservations")).toHaveAttribute("href", "#/mine");
  });

  test("an open Back out confirmation is not closed by Forget", async ({ page }) => {
    await openMine(page);
    await t(page, "mine-group-reserved").getByTestId("backout-open").first().click();
    await expect(t(page, "backout-confirm")).toBeVisible();
    await t(page, "mine-forget").click();
    await expect(t(page, "backout-confirm")).toBeVisible();
  });
});

test.describe("the reserve screen", () => {
  const KETTLE = "I-9001"; // a single item with nobody on it (catalogue fixture)
  async function openReserve(page: Page, extra: Record<string, string>) {
    await setupApi(page);
    await seedStorage(page, extra);
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await page.locator(`[data-testid="item-row"][data-id="${KETTLE}"]`).getByTestId("add-button").click();
    await t(page, "basket-reserve").click();
    await expect(t(page, "reserve-form")).toBeVisible();
  }

  test("has no Forget button, even with details remembered, but still fills them in", async ({ page }) => {
    await openReserve(page, { [BUYER_KEY]: BUYER_JSON });
    await expect(t(page, "reserve-name")).toHaveValue(BUYER_NAME);
    expect((await t(page, "reserve-number").inputValue()).replace(/\D/g, "")).toContain("9000000012");
    await expect(t(page, "reserve-forget")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /forget/i })).toHaveCount(0);
  });

  test("has no Forget button for a first-time visitor either", async ({ page }) => {
    await openReserve(page, {});
    await expect(t(page, "reserve-name")).toHaveValue("");
    await expect(t(page, "reserve-forget")).toHaveCount(0);
  });

  test("after Forget on My reservations the reserve form starts empty", async ({ page }) => {
    await setupApi(page);
    await seedStorage(page, { [BUYER_KEY]: BUYER_JSON, [BOOKINGS_KEY]: both });
    await page.goto("/#/mine");
    await expect(t(page, "mine-group-reserved")).toBeVisible();
    await t(page, "mine-forget").click();
    await t(page, "mine-back").click();
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await page.locator(`[data-testid="item-row"][data-id="${KETTLE}"]`).getByTestId("add-button").click();
    await t(page, "basket-reserve").click();
    await expect(t(page, "reserve-name")).toHaveValue("");
    await expect(t(page, "reserve-number")).toHaveValue("");
  });
});
