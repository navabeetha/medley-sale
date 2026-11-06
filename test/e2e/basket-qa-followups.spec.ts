// S-09 QA follow-ups (D-038 rule 8; QA log "S-09 basket" 2026-11-06, findings F1 to F4 plus coverage gaps).
// API mocked; synthetic data only. Written BEFORE the fixes: F1 to F4 must fail on the current code.
//
// Storage keys are read from src/site (basket-view.ts, main.ts). If those keys are renamed these
// tests need the same rename; they are the only coupling to internals, and only the F4 tests use them.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS, item, response } from "../fixtures/catalogue-fixture";
import { mockApi, mockPhotos, networkDown, ok, type ApiHandler } from "./helpers";

// One routed handler that delegates to a variable, so the answer can change between page loads.
let current: ApiHandler = ok();
const routed = new WeakSet<Page>();
const api = async (page: Page, h: ApiHandler): Promise<void> => {
  current = h;
  if (routed.has(page)) return;
  routed.add(page);
  await mockApi(page, (route) => current(route));
};

/** An API answer that is held back until open() is called, so a test controls exactly when "live" arrives. */
function gated(body: unknown): { handler: ApiHandler; open: () => void } {
  let open!: () => void;
  const gate = new Promise<void>((res) => { open = res; });
  return { handler: async (route) => { await gate; await ok(body)(route); }, open };
}

const CATALOGUE_KEY = "medley-sale:catalogue:v1";
const MANIFEST_KEY = "medley-sale:manifest:v1";

const reserving = (items = ITEMS) => ({ ...response(items), reserving: true });
const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-id="${id}"]`);
const bar = (page: Page) => page.getByTestId("basket-bar");
const reserveBtn = (page: Page) => page.getByTestId("basket-reserve");
const KETTLE = "I-9001";
const DUMBBELL = "I-9003";
const NOVEL = "I-9004";

// 15-unit limit fixtures: big stock so the basket limit (not the item limit) refuses, plus enough
// single items that the page is taller than a phone screen.
const FILLERS = Array.from({ length: 14 }, (_, i) =>
  item({ id: `I-93${String(i).padStart(2, "0")}`, name: `Test Filler ${i + 1}` }));
const LONG = [
  item({ id: "I-9101", name: "Test Pencil Box", quantity: 10, unitsLeft: 10, freeUnits: 10 }),
  item({ id: "I-9102", name: "Test Sticker Pack", quantity: 10, unitsLeft: 10, freeUnits: 10 }),
  ...FILLERS,
];

const inc = async (page: Page, id: string, times: number) => {
  for (let i = 0; i < times; i++) await row(page, id).getByTestId("stepper-inc").click();
};

/** Fill the basket to 15 and press + once more so the refusal message shows. */
async function fillAndRefuse(page: Page): Promise<void> {
  await inc(page, "I-9101", 10);
  await inc(page, "I-9102", 5);
  await expect(reserveBtn(page)).toHaveText("Reserve (15)");
  await row(page, "I-9102").getByTestId("stepper-inc").click();
  await expect(page.getByTestId("basket-message")).toBeVisible();
}

/** Raw localStorage text of everything that is neither the catalogue cache nor the photo manifest. */
const basketStorage = (page: Page) =>
  page.evaluate(([c, m]) => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k !== c && k !== m) out.push(localStorage.getItem(k) ?? "");
    }
    return out.join("\n");
  }, [CATALOGUE_KEY, MANIFEST_KEY]);

test.beforeEach(async ({ page }) => {
  await mockPhotos(page);
});

test.describe("F1: the last row stays clear of the bar while the refusal message shows", () => {
  for (const width of [390, 320]) {
    test(`at ${width} px, scrolled to the end, the last row's controls are fully above the bar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await api(page, ok(reserving(LONG)));
      await page.goto("/");
      await expect(page.getByTestId("item-row")).toHaveCount(LONG.length);
      await fillAndRefuse(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const barTop = (await bar(page).boundingBox())!.y;
      const last = page.getByTestId("item-row").last();
      for (const b of await last.locator("button").all()) {
        const box = (await b.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(barTop + 0.5);
      }
      const rowBox = (await last.boundingBox())!;
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(barTop + 0.5);
    });
  }

  test("the reserved space follows the bar's real height (a taller message still leaves the last row clear)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    await api(page, ok(reserving(LONG)));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(LONG.length);
    await fillAndRefuse(page);
    // Simulates larger system text: the message becomes several lines, the bar grows well past any fixed guess.
    // (Set through the CSSOM: the site's CSP forbids injected <style> elements.)
    await page.getByTestId("basket-message").evaluate((e) => { e.style.fontSize = "1.75rem"; });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const barTop = (await bar(page).boundingBox())!.y;
    const lastBtn = page.getByTestId("item-row").last().locator("button").last();
    const box = (await lastBtn.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(barTop + 0.5);
  });
});

test.describe("F2: keyboard focus never lands under the bar", () => {
  test("at 390x600, tabbing from the top, every focused control is fully above the bar's top", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await api(page, ok(reserving(LONG)));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(LONG.length);
    await row(page, "I-9101").getByTestId("stepper-inc").click();
    await expect(bar(page)).toBeVisible();
    await page.reload(); // fresh focus order and scroll position; the basket persists
    await expect(page.getByTestId("item-row")).toHaveCount(LONG.length);
    const barTop = (await bar(page).boundingBox())!.y;
    await page.evaluate(() => window.scrollTo(0, 0));

    // WebKit's plain Tab skips buttons (macOS "Tab highlights each item" is off); Alt+Tab visits every control.
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
    let stops = 0;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press(tab);
      const f = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        const r = a.getBoundingClientRect();
        return { inList: !!a.closest('[data-testid="item-row"]'), bottom: r.bottom, label: a.getAttribute("data-testid") ?? a.tagName };
      });
      if (!f.inList) break; // reached the bar's own link (or wrapped round)
      stops++;
      expect(f.bottom, `focus stop ${stops} (${f.label}) must end above the bar top ${barTop}`).toBeLessThanOrEqual(barTop + 0.5);
    }
    // Guard against a vacuous pass: the list has 2 stepper buttons plus 14 Add buttons.
    expect(stops).toBeGreaterThanOrEqual(10);
  });
});

test.describe("F3: focus is kept when the live list replaces the cached list", () => {
  const cases: [string, string, string][] = [
    ["an Add button", KETTLE, "add-button"],
    ["a stepper's + button", DUMBBELL, "stepper-inc"],
  ];
  for (const [name, id, testid] of cases) {
    test(`focus on ${name}, activated from the keyboard before the live response, is still there after it`, async ({ page }) => {
      await api(page, ok(reserving()));
      await page.goto("/"); // fills the cache
      await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
      const live = [...ITEMS, item({ id: "I-9005", name: "Test Live Extra" })]; // marks the live render
      const g = gated(reserving(live));
      await api(page, g.handler);
      await page.reload();
      await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length); // the cached list
      const control = row(page, id).getByTestId(testid);
      await control.focus();
      await page.keyboard.press("Enter");
      g.open();
      await expect(page.getByTestId("item-row")).toHaveCount(live.length); // the live list has replaced it
      const focused = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        return { rowId: (a.closest('[data-testid="item-row"]') as HTMLElement | null)?.dataset.id ?? null, testid: a.dataset.testid ?? null };
      });
      expect(focused).toEqual({ rowId: id, testid });
      await expect(reserveBtn(page)).toHaveText("Reserve (1)"); // and the keyboard press itself was not lost
    });
  }
});

test.describe("F4: a cached render prunes the basket for display only", () => {
  // Arrange what a failed cache write leaves behind: the basket holds NOVEL, the saved list does not.
  async function staleCache(page: Page): Promise<void> {
    await api(page, ok(reserving()));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await row(page, KETTLE).getByTestId("add-button").click();
    await row(page, NOVEL).getByTestId("add-button").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (2)");
    await page.evaluate((k) => {
      const c = JSON.parse(localStorage.getItem(k)!) as { items: { id: string }[] };
      c.items = c.items.filter((i) => i.id !== "I-9004");
      localStorage.setItem(k, JSON.stringify(c));
    }, CATALOGUE_KEY);
  }

  test("the stored basket still has the item after a cached render while the live response is pending, and it is shown again once live arrives", async ({ page }) => {
    await staleCache(page);
    const g = gated(reserving());
    await api(page, g.handler);
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length - 1); // the stale cached list
    expect(await basketStorage(page)).toContain(NOVEL); // the cached render may hide it, not delete it
    g.open();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(row(page, NOVEL).getByTestId("add-button")).toHaveText("Added ✓");
    await expect(reserveBtn(page)).toHaveText("Reserve (2)");
  });

  test("the stored basket still has the item when the live response fails", async ({ page }) => {
    await staleCache(page);
    await api(page, networkDown);
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length - 1);
    await expect(page.getByTestId("catalogue-error")).toBeVisible(); // the live attempt has settled
    expect(await basketStorage(page)).toContain(NOVEL);
  });

  test("an item that really left the live catalogue is still dropped and written back (pruning still happens, after live)", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    await row(page, NOVEL).getByTestId("add-button").click();
    await api(page, ok(reserving(ITEMS.filter((i) => i.id !== NOVEL))));
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length - 1);
    await expect(reserveBtn(page)).toHaveText("Reserve (1)");
    await expect.poll(() => basketStorage(page)).not.toContain(NOVEL);
  });
});

test.describe("coverage gaps from the QA log", () => {
  test("the refusal message clears after the next successful change", async ({ page }) => {
    await api(page, ok(reserving(LONG)));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(LONG.length);
    await fillAndRefuse(page);
    await row(page, "I-9102").getByTestId("stepper-dec").click();
    await expect(page.getByTestId("basket-message")).toHaveCount(0);
    await expect(reserveBtn(page)).toHaveText("Reserve (14)");
  });

  test("non-reserving mode leaves the stored basket intact; it returns when reserving comes back (across reloads)", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    await inc(page, DUMBBELL, 2);
    await expect(reserveBtn(page)).toHaveText("Reserve (3)");

    await api(page, ok({ ...response(), reserving: false }));
    await page.reload();
    await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(ITEMS.length); // live R1 view
    await expect(bar(page)).toHaveCount(0);
    await page.reload(); // second reload: now from an R1 cache too
    await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(ITEMS.length);
    await expect(bar(page)).toHaveCount(0);

    await api(page, ok(reserving()));
    await page.reload();
    await expect(reserveBtn(page)).toHaveText("Reserve (3)");
    await expect(row(page, KETTLE).getByTestId("add-button")).toHaveText("Added ✓");
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("2");
  });
});
