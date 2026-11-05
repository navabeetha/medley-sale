// S-06 catalogue screen, as amended by D-034 (browse-only, "Message to reserve" link).
// API and photo manifest are mocked (helpers.ts); no real photos or numbers are involved.
//
// DOM CONTRACT pinned here (data-testid unless noted):
//   loading            the loading line, exact text LOADING_TEXT; removed once the list or error shows
//   early-note         the one-line early-version note, exact text EARLY_NOTE, visible in every state
//   catalogue          <ul> of rows (role list); one <li data-testid="item-row" data-id="<ID>"> per item, in display order
//   in each row:
//     item-name        title text (Books: "name — author")
//     item-sub         brand line (absent when no brand)
//     item-price       "₹1,200" or "Ask"
//     item-pickup      "Pick up anytime" / "Pick up from 2 Dec"
//     item-status      availability labels joined (absent when there are none)
//     img.thumb        72x72 attrs, loading=lazy, alt from manifest, src photos/<thumb>; absent without a photo
//     a[role link, name "Message to reserve"]   href = reserveUrl(contactUrl, name); min 44x44 px
//   catalogue-error    friendly fallback (role alert) containing a button "Try again"; contains an
//                      a[href^="https://wa.me/"] ONLY when a contact URL is known from an earlier good response
//   Fetch: GET to a script.google.com host with ?action=catalogue; manifest from photos/manifest.json.
//   Timeout: a request with no answer shows the fallback after more than 14 s and by 31 s.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS, MANIFEST, CONTACT_URL, item, response } from "../fixtures/catalogue-fixture";
import {
  errorJson, hang, htmlPage, mockApi, mockPhotos, networkDown, ok, serverError, type ApiHandler,
} from "./helpers";

const LOADING_TEXT = "Loading the sale… this can take a few seconds";
const EARLY_NOTE = "This is an early version. If anything looks odd, just message me.";

const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-id="${id}"]`);
const rows = (page: Page) => page.getByTestId("item-row");

test.beforeEach(async ({ page }) => {
  await mockPhotos(page);
});

test.describe("loading and first render", () => {
  test("shows the loading line while waiting, then replaces it with the list", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await mockApi(page, async (route) => {
      await gate;
      await ok()(route);
    });
    await page.goto("/");
    await expect(page.getByTestId("loading")).toHaveText(LOADING_TEXT);
    await expect(rows(page)).toHaveCount(0);
    release();
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(page.getByTestId("loading")).toHaveCount(0);
  });

  test("keeps the h1 title and shows the early-version note above the list", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A44 Medley Garage Sale");
    await expect(page.getByTestId("early-note")).toHaveText(EARLY_NOTE);
    const noteY = (await page.getByTestId("early-note").boundingBox())!.y;
    await expect(rows(page).first()).toBeVisible();
    expect((await rows(page).first().boundingBox())!.y).toBeGreaterThan(noteY);
  });

  test("requests the catalogue action from the API host", async ({ page }) => {
    const seen = await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page).first()).toBeVisible();
    expect(seen.urls.length).toBeGreaterThan(0);
    expect(new URL(seen.urls[0]!).searchParams.get("action")).toBe("catalogue");
  });

  test("keeps the sheet's 'All prices negotiable' note, and the Books note when Books are listed", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(page.getByText("All prices negotiable")).toBeVisible();
    await expect(page.getByText("Free for libraries and students")).toBeVisible();
  });
});

test.describe("rows (brief 6.2, 7; D-006, D-007)", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
  });

  test("orders free items first, then reserved, keeping API order within each group", async ({ page }) => {
    // API order: Kettle(free), Lamp(reserved), Dumbbells(free), Novel(free)
    const ids = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
    expect(ids).toEqual(["I-9001", "I-9003", "I-9004", "I-9002"]);
  });

  test("shows name, brand, price and pickup for a single free item, with no status label", async ({ page }) => {
    const r = row(page, "I-9001");
    await expect(r.getByTestId("item-name")).toHaveText("Test Kettle");
    await expect(r.getByTestId("item-sub")).toHaveText("Acme");
    await expect(r.getByTestId("item-price")).toHaveText("₹1,200");
    await expect(r.getByTestId("item-pickup")).toHaveText("Pick up anytime");
    await expect(r.getByTestId("item-status")).toHaveCount(0);
  });

  test("shows '3 left' for a multi-quantity item with free units", async ({ page }) => {
    await expect(row(page, "I-9003").getByTestId("item-status")).toHaveText(/3 left/);
  });

  test("shows Reserved, '2 waiting' and the dated pickup for a held item, as text not colour", async ({ page }) => {
    const r = row(page, "I-9002");
    await expect(r.getByTestId("item-status")).toContainText("Reserved");
    await expect(r.getByTestId("item-status")).toContainText("2 waiting");
    await expect(r.getByTestId("item-pickup")).toHaveText("Pick up from 2 Dec");
  });

  test("shows a Books row as 'name — author', with Ask for a blank price and no thumbnail or placeholder", async ({ page }) => {
    const r = row(page, "I-9004");
    await expect(r.getByTestId("item-name")).toHaveText("Synthetic Novel — A. Writer");
    await expect(r.getByTestId("item-price")).toHaveText("Ask");
    await expect(r.getByTestId("item-sub")).toHaveCount(0);
    await expect(r.locator("img")).toHaveCount(0);
  });

  test("gives an item with a manifest photo a 72 px lazy thumbnail with the manifest alt text", async ({ page }) => {
    const img = row(page, "I-9001").locator("img.thumb");
    await expect(img).toHaveCount(1);
    expect(await img.getAttribute("src")).toMatch(/(^|\/)photos\/I-9001-1-thumb\.webp$/);
    expect(await img.getAttribute("alt")).toBe(MANIFEST["I-9001"]![0]!.alt);
    expect(await img.getAttribute("width")).toBe("72");
    expect(await img.getAttribute("height")).toBe("72");
    expect(await img.getAttribute("loading")).toBe("lazy");
  });

  test("shows no thumbnail, and no empty placeholder box, for an item absent from the manifest", async ({ page }) => {
    await expect(row(page, "I-9002").locator("img")).toHaveCount(0);
    await expect(row(page, "I-9002").locator(".thumb")).toHaveCount(0);
  });

  test("gives every row a Message to reserve link: wa.me contact URL with the item name in ?text=", async ({ page }) => {
    for (const it of ITEMS) {
      const a = row(page, it.id).getByRole("link", { name: "Message to reserve" });
      const href = (await a.getAttribute("href"))!;
      expect(href.startsWith(`${CONTACT_URL}?text=`)).toBe(true);
      expect(new URL(href).searchParams.get("text")).toContain(it.name);
    }
  });

  test("makes the Message to reserve link at least 44 x 44 px", async ({ page }) => {
    const box = (await row(page, "I-9001").getByRole("link", { name: "Message to reserve" }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test("offers no basket, Add, Reserve or waiting-list buttons (browse-only, D-034)", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^(add|reserve|join)/i })).toHaveCount(0);
  });
});

test.describe("an item list with no contact URL", () => {
  test("renders rows without a reserve link when contactUrl is null", async ({ page }) => {
    await mockApi(page, ok(response(ITEMS, null)));
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(0);
  });
  test("shows the empty-list case as a friendly message, not a blank page", async ({ page }) => {
    await mockApi(page, ok(response([])));
    await page.goto("/");
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator("#app")).toContainText(/nothing|no items|check back/i);
  });
});

test.describe("failure handling (D-034 item 3; brief 7 'every failure has a retry')", () => {
  const failures: [string, ApiHandler][] = [
    ["a 500", serverError],
    ["an HTML page instead of JSON", htmlPage],
    ['an {"error"} body', errorJson],
    ["a dropped connection", networkDown],
  ];
  for (const [label, handler] of failures) {
    test(`shows a friendly fallback with Try again when the API answers with ${label}`, async ({ page }) => {
      await mockApi(page, handler);
      await page.goto("/");
      const err = page.getByTestId("catalogue-error");
      await expect(err).toBeVisible();
      await expect(err.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByTestId("loading")).toHaveCount(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByTestId("early-note")).toHaveText(EARLY_NOTE);
      // No raw error text, stack or JSON may be shown to the neighbour.
      await expect(page.locator("#app")).not.toContainText(/unavailable|boom|Sign in|undefined|\[object/);
    });
  }

  test("never invents a WhatsApp link when no contact URL has been seen (the number is not in the repo)", async ({ page }) => {
    await mockApi(page, serverError);
    await page.goto("/");
    await expect(page.getByTestId("catalogue-error")).toBeVisible();
    await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  });

  test("Try again fetches again and replaces the fallback with the list", async ({ page }) => {
    let handler: ApiHandler = serverError;
    await mockApi(page, (r) => handler(r));
    await page.goto("/");
    await expect(page.getByTestId("catalogue-error")).toBeVisible();
    handler = ok();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(page.getByTestId("catalogue-error")).toHaveCount(0);
  });

  test("gives up on a request that never answers: still loading at 14 s, fallback by 31 s (D-033 misses reach 13 s)", async ({ page }) => {
    await page.clock.install();
    await mockApi(page, hang);
    await page.goto("/");
    await expect(page.getByTestId("loading")).toBeVisible();
    await page.clock.runFor(14_000);
    await expect(page.getByTestId("loading")).toBeVisible();
    await expect(page.getByTestId("catalogue-error")).toHaveCount(0);
    await page.clock.runFor(17_000);
    await expect(page.getByTestId("catalogue-error")).toBeVisible();
    await expect(page.getByTestId("loading")).toHaveCount(0);
  });
});

test.describe("cache in localStorage (S-06 AC; T-14)", () => {
  test("shows the cached list straight away on a repeat visit, before the API answers", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await page.unroute((u) => /script\.google/.test(u.hostname));
    await mockApi(page, hang);
    await page.reload();
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(page.getByTestId("loading")).toHaveCount(0);
  });

  test("refreshes the cached list when the API then answers with newer data", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await page.unroute((u) => /script\.google/.test(u.hostname));
    await mockApi(page, ok(response([item({ id: "I-9100", name: "Fresh Arrival" })])));
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByTestId("item-name")).toHaveText("Fresh Arrival");
  });

  test("keeps showing the cached list, plus the fallback with a WhatsApp link, when a later refresh fails", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await page.unroute((u) => /script\.google/.test(u.hostname));
    await mockApi(page, serverError);
    await page.reload();
    await expect(rows(page)).toHaveCount(ITEMS.length);
    const err = page.getByTestId("catalogue-error");
    await expect(err).toBeVisible();
    expect(await err.locator('a[href^="https://wa.me/"]').count()).toBeGreaterThan(0);
  });

  test("works when localStorage is blocked: list renders, no errors, no crash (T-14)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const deny = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", { get: deny, configurable: true });
    });
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    expect(errors).toEqual([]);
  });

  test("shows the fallback, not a crash, when localStorage is blocked and the API is down", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
        configurable: true,
      });
    });
    await mockApi(page, serverError);
    await page.goto("/");
    await expect(page.getByTestId("catalogue-error")).toBeVisible();
  });

  test("ignores a corrupt cache entry and loads from the API", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) localStorage.setItem(k, "{not json");
    });
    await page.reload();
    await expect(rows(page)).toHaveCount(ITEMS.length);
  });
});

test.describe("safety (brief 6.3, T-10, T-12)", () => {
  const PAYLOAD = `<img src=x onerror="window.__pwned=1">`;

  test("renders hostile item text as inert text, never as markup", async ({ page }) => {
    const evil = [
      item({ id: "I-9201", name: PAYLOAD, brand: PAYLOAD, notes: PAYLOAD }),
      item({ id: "I-9202", name: PAYLOAD, author: PAYLOAD, tab: "Books" }),
    ];
    await mockApi(page, ok(response(evil)));
    await page.goto("/");
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, "I-9201").getByTestId("item-name")).toHaveText(PAYLOAD);
    await expect(row(page, "I-9201").getByTestId("item-sub")).toHaveText(PAYLOAD);
    await expect(row(page, "I-9202").getByTestId("item-name")).toHaveText(`${PAYLOAD} — ${PAYLOAD}`);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("keeps hostile text out of the href except as an encoded ?text= value", async ({ page }) => {
    await mockApi(page, ok(response([item({ id: "I-9201", name: `"><script>x</script> & more` })])));
    await page.goto("/");
    const href = (await rows(page).first().getByRole("link", { name: "Message to reserve" }).getAttribute("href"))!;
    expect(href).not.toMatch(/[<>" ]/);
    expect(new URL(href).searchParams.get("text")).toContain(`"><script>x</script> & more`);
  });

  test("ships no phone number in the built script (the number lives only in Script Properties)", async ({ request }) => {
    const js = await (await request.get("/main.js")).text();
    expect(js).not.toMatch(/wa\.me\/\+?\d/);
    expect(js).not.toMatch(/\b(\+?91)?[6-9]\d{9}\b/);
  });
});

test.describe("layout", () => {
  test("has no horizontal overflow at 390 px and 320 px, even with long unbroken names", async ({ page }) => {
    const long = "Supercalifragilisticexpialidocious".repeat(4);
    await mockApi(page, ok(response([...ITEMS, item({ id: "I-9300", name: long, brand: long }),
      item({ id: "I-9301", name: long, author: long, tab: "Books" })])));
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length + 2);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("has no horizontal overflow at 320 px in the fallback state", async ({ page }) => {
    await mockApi(page, serverError);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    await expect(page.getByTestId("catalogue-error")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });

  test("keeps cumulative layout shift under 0.1 when a delayed list and thumbnails arrive", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "layout-shift entries exist only in Chromium");
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await mockApi(page, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await ok()(route);
    });
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await page.waitForLoadState("networkidle");
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });
});
