// S-09 basket (D-038 rule 6: reserving mode comes from the catalogue's top-level `reserving`).
// API mocked; synthetic data only. The API track adds `reserving`; here we only mock it.
//
// DOM CONTRACT pinned here (data-testid unless noted). Only when reserving === true:
//   in each item row:
//     add-button     <button> for items whose max units is 1 (max = free units, or 1 when none free).
//                    Text "Add"  <-> "Added ✓" (aria-pressed false/true). Clicking toggles.
//                    For an item with no free units the text is "Join waiting list" <-> "On waiting list ✓".
//     stepper        for items whose max is above 1 (REPLACES add-button), containing:
//       stepper-dec  <button> "Remove one"   disabled at 0
//       stepper-count  text of the current number ("0" when none)
//       stepper-inc  <button> "Add one"     disabled at the item's max (free units)
//     No "Message to reserve" link and no wa.me link in any row.
//   basket-bar       sticky/fixed to the bottom of the viewport; ABSENT from the DOM when the basket is empty.
//                    Its padding-bottom uses env(safe-area-inset-bottom) (public/style.css) and the page
//                    has viewport-fit=cover (public/index.html).
//   basket-reserve   <a> or <button> in the bar, accessible role link/button, text "Reserve (n)",
//                    n = total UNITS. Click -> location.hash becomes "#/reserve" (S-10 builds the screen).
//   basket-message   role="alert" element with a clear message (mentions 15) when a unit is refused;
//                    absent otherwise (not required to clear on its own).
//   Persistence: the basket survives a reload (localStorage, any key). Items no longer in the
//   catalogue are dropped silently on load; units are lowered to what the item now allows.
// When `reserving` is false, missing or not exactly true: none of the above exists; R1 behaviour.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS, item, response } from "../fixtures/catalogue-fixture";
import { mockApi, mockPhotos, networkDown, ok, type ApiHandler } from "./helpers";

// A mock whose answer can be swapped between a page load and a reload (page.unroute needs the
// original handler reference, so one routed handler delegates to a variable instead).
let current: ApiHandler = ok();
const swap = (h: ApiHandler): void => { current = h; };
const routed = new WeakSet<Page>();
const api = async (page: Page, h: ApiHandler): Promise<void> => {
  swap(h);
  if (routed.has(page)) return;
  routed.add(page);
  await mockApi(page, (route) => current(route));
};

const reserving = (items = ITEMS) => ({ ...response(items), reserving: true });

const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-id="${id}"]`);
const bar = (page: Page) => page.getByTestId("basket-bar");
const reserveBtn = (page: Page) => page.getByTestId("basket-reserve");
const KETTLE = "I-9001"; // single, free
const LAMP = "I-9002"; // single, nothing free (waiting list)
const DUMBBELL = "I-9003"; // quantity 3, 3 free
const NOVEL = "I-9004"; // single, free

// Big stock so the 15-unit limit (not the item limit) is what refuses.
const BIG = [
  item({ id: "I-9101", name: "Test Pencil Box", quantity: 10, unitsLeft: 10, freeUnits: 10 }),
  item({ id: "I-9102", name: "Test Sticker Pack", quantity: 10, unitsLeft: 10, freeUnits: 10 }),
  item({ id: "I-9103", name: "Test Magnet" }),
];

const inc = (page: Page, id: string, times = 1) =>
  (async () => { for (let i = 0; i < times; i++) await row(page, id).getByTestId("stepper-inc").click(); })();

test.beforeEach(async ({ page }) => {
  await mockPhotos(page);
});

test.describe("not in reserving mode: exactly as before (D-038 rule 6)", () => {
  const cases: [string, unknown][] = [
    ["reserving is false", { ...response(), reserving: false }],
    ["reserving is missing (an older response)", response()],
    ["reserving is not a real boolean", { ...response(), reserving: "true" }],
  ];
  for (const [name, body] of cases) {
    test(`${name}: message-to-reserve links, no Add, no stepper, no basket`, async ({ page }) => {
      await api(page, ok(body));
      await page.goto("/");
      await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
      await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(ITEMS.length);
      await expect(page.getByTestId("add-button")).toHaveCount(0);
      await expect(page.getByTestId("stepper")).toHaveCount(0);
      await expect(bar(page)).toHaveCount(0);
      await expect(page.getByText("Join waiting list")).toHaveCount(0);
    });
  }
});

test.describe("reserving mode: cards", () => {
  test.beforeEach(async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
  });

  test("shows Add on free single items and no per-card WhatsApp link anywhere", async ({ page }) => {
    await expect(row(page, KETTLE).getByTestId("add-button")).toHaveText("Add");
    await expect(row(page, NOVEL).getByTestId("add-button")).toHaveText("Add");
    await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(0);
    await expect(page.locator('[data-testid="item-row"] a[href^="https://wa.me/"]')).toHaveCount(0);
  });

  test("shows 'Join waiting list' (not Add) for an item with no free units", async ({ page }) => {
    await expect(row(page, LAMP).getByTestId("add-button")).toHaveText("Join waiting list");
  });

  test("shows a stepper, not an Add button, for a multi-unit item", async ({ page }) => {
    await expect(row(page, DUMBBELL).getByTestId("stepper")).toBeVisible();
    await expect(row(page, DUMBBELL).getByTestId("add-button")).toHaveCount(0);
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("0");
  });

  test("Add toggles with a text-based selected state, and toggles back", async ({ page }) => {
    const add = row(page, KETTLE).getByTestId("add-button");
    await add.click();
    await expect(add).toHaveText("Added ✓");
    await expect(add).toHaveAttribute("aria-pressed", "true");
    await add.click();
    await expect(add).toHaveText("Add");
    await expect(add).toHaveAttribute("aria-pressed", "false");
  });

  test("a waiting-list item can be added too, with its own text state", async ({ page }) => {
    const add = row(page, LAMP).getByTestId("add-button");
    await add.click();
    await expect(add).toHaveText("On waiting list ✓");
    await expect(reserveBtn(page)).toHaveText("Reserve (1)");
    await add.click();
    await expect(add).toHaveText("Join waiting list");
    await expect(bar(page)).toHaveCount(0);
  });

  test("the stepper counts up to the free units and stops there", async ({ page }) => {
    const r = row(page, DUMBBELL);
    await inc(page, DUMBBELL, 3);
    await expect(r.getByTestId("stepper-count")).toHaveText("3");
    await expect(r.getByTestId("stepper-inc")).toBeDisabled();
    await expect(reserveBtn(page)).toHaveText("Reserve (3)");
  });

  test("the stepper goes down to 0 and cannot go below it", async ({ page }) => {
    const r = row(page, DUMBBELL);
    await expect(r.getByTestId("stepper-dec")).toBeDisabled();
    await inc(page, DUMBBELL, 2);
    await r.getByTestId("stepper-dec").click();
    await expect(r.getByTestId("stepper-count")).toHaveText("1");
    await r.getByTestId("stepper-dec").click();
    await expect(r.getByTestId("stepper-count")).toHaveText("0");
    await expect(r.getByTestId("stepper-dec")).toBeDisabled();
    await expect(bar(page)).toHaveCount(0);
  });

  test("the stepper limit is the FREE units, not the stock", async ({ page }) => {
    await api(page, ok(reserving([item({ id: "I-9201", name: "Test Stool", quantity: 3, unitsLeft: 3, freeUnits: 2 })])));
    await page.goto("/");
    await inc(page, "I-9201", 2);
    await expect(row(page, "I-9201").getByTestId("stepper-count")).toHaveText("2");
    await expect(row(page, "I-9201").getByTestId("stepper-inc")).toBeDisabled();
  });
});

test.describe("reserving mode: the basket bar", () => {
  test.beforeEach(async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
  });

  test("is not there until something is selected", async ({ page }) => {
    await expect(bar(page)).toHaveCount(0);
  });

  test("appears with 'Reserve (n)' counting total units, and updates as things change", async ({ page }) => {
    await row(page, KETTLE).getByTestId("add-button").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (1)");
    await inc(page, DUMBBELL, 2);
    await expect(reserveBtn(page)).toHaveText("Reserve (3)"); // 1 kettle + 2 dumbbells: units, not items
    await row(page, KETTLE).getByTestId("add-button").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (2)");
  });

  test("goes away when the last unit is removed", async ({ page }) => {
    const add = row(page, KETTLE).getByTestId("add-button");
    await add.click();
    await expect(bar(page)).toBeVisible();
    await add.click();
    await expect(bar(page)).toHaveCount(0);
  });

  test("is stuck to the bottom of the viewport even when scrolled to the top", async ({ page }) => {
    await row(page, KETTLE).getByTestId("add-button").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const vh = page.viewportSize()!.height;
    const box = (await bar(page).boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(vh - 2);
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 1);
    expect(["fixed", "sticky"]).toContain(await bar(page).evaluate((e) => getComputedStyle(e).position));
  });

  test("does not hide the last item: scrolled to the end, the last row's button sits above the bar", async ({ page }) => {
    await row(page, KETTLE).getByTestId("add-button").click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const barTop = (await bar(page).boundingBox())!.y;
    const last = page.getByTestId("item-row").last();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(barTop + 1);
  });

  test("respects the safe-area inset (CSS uses env(safe-area-inset-bottom); viewport-fit=cover)", async ({ request }) => {
    const css = await (await request.get("/style.css")).text();
    expect(css).toMatch(/env\(\s*safe-area-inset-bottom/);
    const html = await (await request.get("/")).text();
    expect(html).toMatch(/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/);
  });

  test("the Reserve button navigates to #/reserve", async ({ page }) => {
    await row(page, KETTLE).getByTestId("add-button").click();
    await reserveBtn(page).click();
    await expect.poll(() => new URL(page.url()).hash).toBe("#/reserve");
  });

  test("the bar's button is exposed as a link or button with the Reserve (n) name", async ({ page }) => {
    await row(page, KETTLE).getByTestId("add-button").click();
    await expect(bar(page).getByRole(/* either */ "button", { name: "Reserve (1)" })
      .or(bar(page).getByRole("link", { name: "Reserve (1)" }))).toHaveCount(1);
  });
});

test.describe("reserving mode: tap targets (brief 7, at least 44 px)", () => {
  test("Add, stepper buttons and the Reserve button are at least 44 x 44 px", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    const targets = [
      row(page, KETTLE).getByTestId("add-button"),
      row(page, LAMP).getByTestId("add-button"),
      row(page, DUMBBELL).getByTestId("stepper-inc"),
      row(page, DUMBBELL).getByTestId("stepper-dec"),
      reserveBtn(page),
    ];
    for (const t of targets) {
      await t.scrollIntoViewIfNeeded();
      const box = (await t.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("reserving mode: the 15-unit limit (brief 6.3)", () => {
  test.beforeEach(async ({ page }) => {
    await api(page, ok(reserving(BIG)));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(BIG.length);
    await inc(page, "I-9101", 10);
    await inc(page, "I-9102", 5);
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
  });

  test("reaching exactly 15 is allowed and shows no message", async ({ page }) => {
    await expect(page.getByTestId("basket-message")).toHaveCount(0);
  });

  test("a 16th unit from a stepper is refused with a clear message, and nothing changes", async ({ page }) => {
    await row(page, "I-9102").getByTestId("stepper-inc").click();
    const msg = page.getByTestId("basket-message");
    await expect(msg).toBeVisible();
    await expect(msg).toHaveAttribute("role", "alert");
    await expect(msg).toContainText("15");
    await expect(row(page, "I-9102").getByTestId("stepper-count")).toHaveText("5");
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
  });

  test("a 16th unit from an Add button is refused too, and the button stays unselected", async ({ page }) => {
    const add = row(page, "I-9103").getByTestId("add-button");
    await add.click();
    await expect(page.getByTestId("basket-message")).toContainText("15");
    await expect(add).toHaveText("Add");
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
  });

  test("removing a unit makes room again", async ({ page }) => {
    await row(page, "I-9102").getByTestId("stepper-dec").click();
    await row(page, "I-9103").getByTestId("add-button").click();
    await expect(row(page, "I-9103").getByTestId("add-button")).toHaveText("Added ✓");
    await expect(reserveBtn(page)).toHaveText("Reserve (15)");
  });
});

test.describe("reserving mode: persistence (localStorage)", () => {
  test("the basket and the bar survive a reload", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    await inc(page, DUMBBELL, 2);
    await row(page, LAMP).getByTestId("add-button").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (4)");
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(reserveBtn(page)).toHaveText("Reserve (4)");
    await expect(row(page, KETTLE).getByTestId("add-button")).toHaveText("Added ✓");
    await expect(row(page, LAMP).getByTestId("add-button")).toHaveText("On waiting list ✓");
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("2");
  });

  test("a removal also survives a reload (the bar does not come back)", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    const add = row(page, KETTLE).getByTestId("add-button");
    await add.click();
    await add.click();
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(bar(page)).toHaveCount(0);
  });

  test("items no longer in the catalogue are dropped silently on reload", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    await row(page, NOVEL).getByTestId("add-button").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (2)");
    swap(ok(reserving(ITEMS.filter((i) => i.id !== KETTLE))));
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length - 1);
    await expect(reserveBtn(page)).toHaveText("Reserve (1)");
    await expect(page.getByTestId("basket-message")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("when every basket item is gone the bar disappears", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    swap(ok(reserving(ITEMS.filter((i) => i.id !== KETTLE))));
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length - 1);
    await expect(bar(page)).toHaveCount(0);
  });

  test("units are lowered when the item now has fewer free", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await inc(page, DUMBBELL, 3);
    swap(ok(reserving(ITEMS.map((i) => (i.id === DUMBBELL ? { ...i, freeUnits: 1 } : i)))));
    await page.reload();
    await expect(row(page, DUMBBELL).getByTestId("add-button")).toHaveText("Added ✓"); // max is now 1: Add, not a stepper
    await expect(reserveBtn(page)).toHaveText("Reserve (1)");
  });

  test("a corrupt stored basket does not crash the page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) localStorage.setItem(k, "{not json"); });
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(bar(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("works with localStorage blocked: Add and the bar work for the session, no errors (T-14)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const deny = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: deny, configurable: true });
    });
    await api(page, ok(reserving()));
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await row(page, KETTLE).getByTestId("add-button").click();
    await expect(reserveBtn(page)).toHaveText("Reserve (1)");
    expect(errors).toEqual([]);
  });

  test("keeps reserving mode (and the basket) from the saved list when the API is down on reload", async ({ page }) => {
    await api(page, ok(reserving()));
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    swap(networkDown);
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(row(page, KETTLE).getByTestId("add-button")).toHaveText("Added ✓");
    await expect(reserveBtn(page)).toHaveText("Reserve (1)");
    await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(0);
  });
});
