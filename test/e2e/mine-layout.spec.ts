// S-19: the #/mine page on a phone (brief 7: 44 px controls; story criterion 6: 320 and 390 px, no sideways scroll). Red step.
// Uses the DOM contract of mine.spec.ts and mine-details.spec.ts; adds no testids of its own.
// The viewport is set per test (320 and 390 wide) on top of whichever device profile runs the spec.
import { test, expect, type Page } from "@playwright/test";
import { json } from "./helpers";
import {
  BOOKINGS_KEY, BUYER_JSON, BUYER_KEY, MINE_VIEW, OTHER_TOKEN, TOKEN, line, mineReply, seedStorage, setupApi, tok, waiting,
} from "./booking-helpers";

const t = (p: Page, id: string) => p.getByTestId(id);
const LONG = "Test Extraordinarily Long Item Name With Many Words That Must Wrap Not Overflow";
const UNBROKEN = "Test" + "Wordwithoutanyspaces".repeat(6); // a long unbroken run, like a long brand or URL-ish name
/** The fullest page: long and unbroken names, a quantity, a waiting unit, all three sections, the buttons and the details. */
const FULL = mineReply({
  reserved: [
    tok(TOKEN, line("I-9101", LONG, [11, 12], UNBROKEN)),
    tok(OTHER_TOKEN, line("I-9105", UNBROKEN, [17])),
    ...MINE_VIEW.reserved.slice(0, 1),
  ],
  waiting: [tok(TOKEN, waiting(13, "I-9002", LONG, 12))],
});

for (const width of [320, 390]) {
  test.describe(`${width} px wide`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await setupApi(page, { mine: (r) => json(FULL)(r) });
      await seedStorage(page, { [BOOKINGS_KEY]: JSON.stringify([OTHER_TOKEN, TOKEN]), [BUYER_KEY]: BUYER_JSON });
      await page.goto("/#/mine");
      await expect(t(page, "mine-group-backedout")).toBeVisible();
    });

    const overflow = (page: Page) => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, body: document.body.scrollWidth }));

    test("does not scroll sideways, with long names", async ({ page }) => {
      const o = await overflow(page);
      expect(o.doc).toBeLessThanOrEqual(o.win);
      expect(o.body).toBeLessThanOrEqual(o.win);
    });

    test("does not scroll sideways with a Back out confirmation open", async ({ page }) => {
      await t(page, "mine-group-reserved").getByTestId("backout-open").first().click();
      await expect(t(page, "backout-confirm")).toBeVisible();
      const o = await overflow(page);
      expect(o.doc).toBeLessThanOrEqual(o.win);
    });

    test("no line, button or link sticks out past the right edge", async ({ page }) => {
      const wide = await page.evaluate(() => {
        const w = window.innerWidth;
        return [...document.querySelectorAll('[data-testid="mine-page"] *')]
          .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > w + 0.5)
          .map((e) => e.getAttribute("data-testid") ?? e.tagName);
      });
      expect(wide).toEqual([]);
    });

    test("every control is at least 44 px tall and wide", async ({ page }) => {
      await t(page, "mine-group-reserved").getByTestId("backout-open").first().click();
      for (const id of ["backout-open", "mine-whatsapp", "mine-tell-seller", "mine-forget", "mine-back", "backout-yes", "backout-cancel"]) {
        const all = t(page, id);
        const n = await all.count();
        expect(n, `${id} is present`).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
          await all.nth(i).scrollIntoViewIfNeeded();
          const b = await all.nth(i).boundingBox();
          expect(b, `${id} #${i} has a box`).not.toBeNull();
          expect(b!.height, `${id} #${i} height`).toBeGreaterThanOrEqual(44);
          expect(b!.width, `${id} #${i} width`).toBeGreaterThanOrEqual(44);
        }
      }
    });

    test("the controls do not overlap one another", async ({ page }) => {
      const boxes = await page.evaluate(() =>
        ["backout-open", "mine-whatsapp", "mine-tell-seller", "mine-forget"].flatMap((id) =>
          [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => { const r = e.getBoundingClientRect(); return { id, l: r.left, r: r.right, t: r.top, b: r.bottom }; })));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        expect(overlap, `${a.id} and ${b.id}`).toBe(false);
      }
    });
  });
}
