// S-10 carried bugfix tickets B1 to B3 (S-09 QA re-check, PM 2026-11-06). Written BEFORE the fixes:
// each test below must fail on the current code. API mocked; synthetic data only.
//
// Storage keys are read from src/site (main.ts) only to build a stale catalogue cache, as the
// S-09 follow-up specs do.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS, item, response } from "../fixtures/catalogue-fixture";
import { mockApi, mockPhotos, ok, type ApiHandler } from "./helpers";

let current: ApiHandler = ok();
const routed = new WeakSet<Page>();
const api = async (page: Page, h: ApiHandler): Promise<void> => {
  current = h;
  if (routed.has(page)) return;
  routed.add(page);
  await mockApi(page, (route) => current(route));
};

/** An answer held back until open() is called, so a test controls exactly when "live" arrives. */
function gated(body: unknown): { handler: ApiHandler; open: () => void } {
  let open!: () => void;
  const gate = new Promise<void>((res) => { open = res; });
  return { handler: async (route) => { await gate; await ok(body)(route); }, open };
}

const CATALOGUE_KEY = "medley-sale:catalogue:v1";
const reserving = (items = ITEMS) => ({ ...response(items), reserving: true });
const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-id="${id}"]`);
const bar = (page: Page) => page.getByTestId("basket-bar");
const reserveBtn = (page: Page) => page.getByTestId("basket-reserve");
const KETTLE = "I-9001";
const DUMBBELL = "I-9003";

test.beforeEach(async ({ page }) => {
  await mockPhotos(page);
});

test.describe("B1: on a short page the basket bar sits at the bottom of the screen", () => {
  const SHORT = [item({ id: "I-9301", name: "Test Short One" }), item({ id: "I-9302", name: "Test Short Two" })];

  for (const [w, h] of [[390, 700], [320, 640]] as const) {
    test(`with 2 items at ${w}x${h}, the bar's bottom edge equals the viewport bottom`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await api(page, ok(reserving(SHORT)));
      await page.goto("/");
      await expect(page.getByTestId("item-row")).toHaveCount(2);
      // The page really is shorter than the screen, otherwise this test proves nothing.
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(h);
      await row(page, "I-9301").getByTestId("add-button").click();
      await expect(bar(page)).toBeVisible();
      const box = (await bar(page).boundingBox())!;
      expect(box.y + box.height).toBeCloseTo(h, 0);
    });
  }
});

test.describe("B2: merging hidden entries back never takes the basket past 15", () => {
  const BIG = [
    item({ id: "I-9101", name: "Test Pencil Box", quantity: 10, unitsLeft: 10, freeUnits: 10 }),
    item({ id: "I-9102", name: "Test Sticker Pack", quantity: 10, unitsLeft: 10, freeUnits: 10 }),
    item({ id: "I-9103", name: "Test Magnet" }),
  ];
  const MAGNET = "I-9103";

  // Arrange: the basket holds Pencil x10 and Magnet x1 (11), but the saved list lacks the Magnet, so
  // the cached render hides it. The buyer then adds Sticker x5 (15 visible) before the live list arrives.
  async function stale(page: Page): Promise<{ open: () => void }> {
    await api(page, ok(reserving(BIG)));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length);
    for (let i = 0; i < 10; i++) await row(page, "I-9101").getByTestId("stepper-inc").click();
    await row(page, MAGNET).getByTestId("add-button").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (11)");
    await page.evaluate((k) => {
      const c = JSON.parse(localStorage.getItem(k)!) as { items: { id: string }[] };
      c.items = c.items.filter((i) => i.id !== "I-9103");
      localStorage.setItem(k, JSON.stringify(c));
    }, CATALOGUE_KEY);
    const g = gated(reserving(BIG));
    await api(page, g.handler);
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length - 1); // stale cached list, no Magnet
    for (let i = 0; i < 5; i++) await row(page, "I-9102").getByTestId("stepper-inc").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
    return g;
  }

  test("after the live list arrives the total is still 15, the hidden entry that does not fit is left out", async ({ page }) => {
    const g = await stale(page);
    g.open();
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length); // live render is in
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
    await expect(row(page, "I-9101").getByTestId("stepper-count")).toHaveText("10");
    await expect(row(page, "I-9102").getByTestId("stepper-count")).toHaveText("5");
    await expect(row(page, MAGNET).getByTestId("add-button")).toHaveText("Add");
  });

  test("the limit message is shown for the entry that did not fit", async ({ page }) => {
    const g = await stale(page);
    g.open();
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length);
    await expect(page.getByTestId("basket-message")).toBeVisible();
    await expect(page.getByTestId("basket-message")).toContainText("15");
  });

  test("the stored basket is at most 15 too: a reload with the same live list still shows 15", async ({ page }) => {
    const g = await stale(page);
    g.open();
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length);
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
    await api(page, ok(reserving(BIG)));
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length);
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
    await expect(row(page, MAGNET).getByTestId("add-button")).toHaveText("Add");
  });

  test("a hidden entry that DOES fit still comes back (no message)", async ({ page }) => {
    await api(page, ok(reserving(BIG)));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length);
    await row(page, "I-9101").getByTestId("stepper-inc").click();
    await row(page, MAGNET).getByTestId("add-button").click();
    await page.evaluate((k) => {
      const c = JSON.parse(localStorage.getItem(k)!) as { items: { id: string }[] };
      c.items = c.items.filter((i) => i.id !== "I-9103");
      localStorage.setItem(k, JSON.stringify(c));
    }, CATALOGUE_KEY);
    const g = gated(reserving(BIG));
    await api(page, g.handler);
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length - 1);
    g.open();
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length);
    await expect(reserveBtn(page)).toHaveText("Reserve (2)");
    await expect(row(page, MAGNET).getByTestId("add-button")).toHaveText("Added ✓");
    await expect(page.getByTestId("basket-message")).toHaveCount(0);
  });
});

test.describe("B3: a stale cached list with fewer free units does not shrink the chosen count for good", () => {
  // The buyer chose all 3 dumbbells. The saved list (stale) says only 1 is free.
  async function stale(page: Page, liveFree: number): Promise<{ open: () => void }> {
    await api(page, ok(reserving()));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    for (let i = 0; i < 3; i++) await row(page, DUMBBELL).getByTestId("stepper-inc").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (3)");
    await page.evaluate((k) => {
      const c = JSON.parse(localStorage.getItem(k)!) as { items: { id: string; freeUnits: number }[] };
      for (const i of c.items) if (i.id === "I-9003") i.freeUnits = 1;
      localStorage.setItem(k, JSON.stringify(c));
    }, CATALOGUE_KEY);
    const live = ITEMS.map((i) => (i.id === DUMBBELL ? { ...i, freeUnits: liveFree } : i));
    const g = gated(reserving(live));
    await api(page, g.handler);
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length); // the cached list
    return g;
  }

  test("changing something else while the stale list shows does not lower the dumbbell count once live says 3 are free", async ({ page }) => {
    const g = await stale(page, 3);
    await row(page, KETTLE).getByTestId("add-button").click(); // any change writes the basket back
    g.open();
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("3");
    await expect(reserveBtn(page)).toHaveText("Reserve (4)");
  });

  test("the chosen count is also still 3 after a reload against the live list", async ({ page }) => {
    const g = await stale(page, 3);
    await row(page, KETTLE).getByTestId("add-button").click();
    g.open();
    await expect(reserveBtn(page)).toHaveText("Reserve (4)");
    await api(page, ok(reserving()));
    await page.reload();
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("3");
  });

  test("a live list that really has fewer free units still lowers the count (and keeps it lowered)", async ({ page }) => {
    const g = await stale(page, 2);
    await row(page, KETTLE).getByTestId("add-button").click();
    g.open();
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("2");
    await expect(reserveBtn(page)).toHaveText("Reserve (3)");
    await expect(row(page, DUMBBELL).getByTestId("stepper-inc")).toBeDisabled(); // at the live max
  });

  test("an untouched stale render followed by live 3 also keeps 3 (guards the no-interaction path)", async ({ page }) => {
    const g = await stale(page, 3);
    g.open();
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("3");
    await expect(reserveBtn(page)).toHaveText("Reserve (3)");
    await expect(bar(page)).toBeVisible();
  });
});
