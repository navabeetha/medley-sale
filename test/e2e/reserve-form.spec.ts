// S-10 reservation form at #/reserve (brief 6.3, 6.4, 7; D-014; D-038; S-11 notes). Written BEFORE the
// code: every test here must fail on the current site. API mocked (GET catalogue and POST reserve);
// synthetic data only.
//
// DOM CONTRACT pinned here (data-testid unless noted). Reserving mode only (catalogue says reserving === true):
//   Routing   location.hash "#/reserve" shows the reservation screen INSTEAD of the catalogue ("catalogue" and
//             "basket-bar" are not shown on it). Hash "" or "#/" shows the catalogue again. It works on a direct
//             load and a reload of "#/reserve" (the basket is read from storage, the catalogue from cache/API).
//             Not in reserving mode: "#/reserve" shows the normal R1 catalogue and none of the elements below exist.
//   reserve-empty    the basket is empty: a friendly message (words like "empty", "nothing" or "no items").
//                    No reserve-form then.
//   reserve-back     <a href="#/"> at least 44 px tall; present on the empty message AND on the form screen.
//   reserve-form     a <form> with the novalidate attribute (our messages show, not the browser's bubbles).
//   reserve-item     one per basket entry, in basket order, with data-id = item id; inside it:
//     reserve-item-name     text of the item (textContent only)
//     reserve-item-units    the number of units, as plain digits ("2")
//     reserve-item-outcome  the likely outcome in WORDS: an item with free units reads "reserve..." (and not
//                           "waiting"); an item with none free reads "waiting list" and "position N" where
//                           N = waitingCount + 1.
//     reserve-item-remove   <button>, at least 44x44 px, accessible name starts "Remove" and names the item.
//                           Removes the whole entry from the basket (also in storage). Removing the last entry
//                           swaps the form for reserve-empty.
//   reserve-name     <input type text> autocomplete="name", with an associated <label> mentioning "name".
//   reserve-number   <input type="tel"> autocomplete="tel", with an associated <label> (phone/number/WhatsApp).
//   reserve-notice   contains exactly "Your number is only seen by the seller and is used only for this sale."
//   reserve-website  the honeypot <input>: autocomplete="off", a non-standard name attribute (not website, url,
//                    email, name, phone, tel), tabindex="-1", aria-hidden="true", visually hidden (tiny or off
//                    screen or transparent) but NOT display:none / visibility:hidden. Value sent as `website`.
//   reserve-submit   <button type="submit">, at least 44 px tall. While a request is pending it is disabled.
//   reserve-status   role="status", visible only while pending, text says "Saving".
//   reserve-name-error / reserve-number-error
//                    messages BESIDE their field: located between the field and the next control, and the field
//                    has aria-invalid="true" and aria-describedby naming the message's id. Both are absent (and
//                    aria-invalid not "true") when the field is fine. Validation runs on submit; the first
//                    invalid field takes focus; nothing is sent while a field is invalid.
//   reserve-error    role="alert" form-level message for every failure that is not about one field.
//   reserve-skipped  (nothing-available) lists the skipped items by NAME, one reserve-skipped-item each.
//   reserve-forget   <button> (at least 44 px tall) shown when details are remembered; clears the saved name and
//                    number from the device and empties the fields.
//   Request  POST to API_URL, no query string, Content-Type text/plain, body JSON with exactly the keys
//            action ("reserve"), name (trimmed), number (E.164 per normalisePhone), idempotencyKey, items
//            ([{id, quantity}] in basket order) and website ("" unless the honeypot was filled).
//   Success  {ok:true, token, ...}: basket cleared, hash becomes "#/b/<token>". The token appears in no query
//            string and in no localStorage KEY name.
import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { ITEMS, item, response } from "../fixtures/catalogue-fixture";
import { normalisePhone } from "../../src/domain/phone";
import { API_URL } from "../../src/site/config";
import { hang, json, mockApi, mockPhotos, networkDown, ok, serverError, htmlPage } from "./helpers";

const KETTLE = "I-9001"; // single, free
const LAMP = "I-9002"; // single, none free, waitingCount 2 -> position 3
const DUMBBELL = "I-9003"; // quantity 3, 3 free
const NOVEL = "I-9004";

const NAME = "Asha Testperson";
const NUMBER = "90000 00012"; // ten digits = India
const E164 = "+919000000012";
// Lowercase hex on purpose: a mixed-case 40+ char run looks like a sheet ID to tools/pii-scan.mjs.
const TOKEN = ["0f1e2d3c4b5a6978", "8796a5b4c3d2e1f0"].join("");
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
const NOTICE = "Your number is only seen by the seller and is used only for this sale.";

const reserving = (items = ITEMS) => ({ ...response(items), reserving: true });
const SUCCESS = { ok: true, token: TOKEN, bookingId: "B-1", units: [], skipped: [], whatsappUrl: null };

interface Sent { url: string; method: string; contentType: string; raw: string; body: Record<string, unknown> }
type PostHandler = (route: Route, sent: Sent) => Promise<void> | void;
const reply = (body: unknown): PostHandler => (route) => json(body)(route);

interface Api { sent: Sent[]; others: string[]; setPost(h: PostHandler): void; setCatalogue(c: unknown): void }

/** Mocks GET catalogue and POST reserve on the API host. Anything else (e.g. a preflight) is recorded in `others`. */
async function setup(page: Page, post: PostHandler = reply(SUCCESS), catalogue: unknown = reserving()): Promise<Api> {
  const api: Api = {
    sent: [], others: [],
    setPost: (h) => { post = h; },
    setCatalogue: (c) => { catalogue = c; },
  };
  await mockApi(page, async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const raw = req.postData() ?? "";
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* left empty: the test will say so */ }
      const sent = { url: req.url(), method: "POST", contentType: req.headers()["content-type"] ?? "", raw, body };
      api.sent.push(sent);
      return post(route, sent);
    }
    if (req.method() !== "GET") {
      api.others.push(req.method());
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
    }
    return ok(catalogue)(route);
  });
  return api;
}

const bar = (p: Page) => p.getByTestId("basket-bar");
const row = (p: Page, id: string) => p.locator(`[data-testid="item-row"][data-id="${id}"]`);
const t = (p: Page, id: string) => p.getByTestId(id);
const hash = (p: Page) => p.evaluate(() => location.hash);

async function addItem(page: Page, id: string, times = 1): Promise<void> {
  const r = row(page, id);
  for (let i = 0; i < times; i++) {
    if ((await r.getByTestId("add-button").count()) > 0) await r.getByTestId("add-button").click();
    else await r.getByTestId("stepper-inc").click();
  }
}

/** Opens the catalogue, adds items, and presses Reserve to land on the form. */
async function openForm(page: Page, adds: [string, number?][] = [[KETTLE]], catalogueSize = ITEMS.length): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("item-row")).toHaveCount(catalogueSize);
  for (const [id, n] of adds) await addItem(page, id, n ?? 1);
  await page.getByTestId("basket-reserve").click();
  await expect(t(page, "reserve-form")).toBeVisible();
  expect(await hash(page)).toBe("#/reserve");
}

async function fill(page: Page, name = NAME, number = NUMBER): Promise<void> {
  await t(page, "reserve-name").fill(name);
  await t(page, "reserve-number").fill(number);
}

async function submit(page: Page): Promise<void> {
  await t(page, "reserve-submit").click();
}

async function expectBooked(page: Page, token = TOKEN): Promise<void> {
  await expect.poll(() => hash(page)).toBe(`#/b/${token}`);
}

/** Every localStorage entry (keys and values). */
const storage = (page: Page) =>
  page.evaluate(() => {
    const out: { key: string; value: string }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      out.push({ key, value: localStorage.getItem(key) ?? "" });
    }
    return out;
  });

async function expectTap(loc: Locator, what: string): Promise<void> {
  const b = await loc.boundingBox();
  expect(b, `${what} has a box`).not.toBeNull();
  expect(b!.height, `${what} height`).toBeGreaterThanOrEqual(44);
  expect(b!.width, `${what} width`).toBeGreaterThanOrEqual(44);
}

test.beforeEach(async ({ page }) => {
  await mockPhotos(page);
});

// ------------------------------------------------------------------ routing and the basket list

test.describe("the screen and the basket list", () => {
  test("Reserve (n) leads to #/reserve, which shows the form and hides the catalogue and the bar", async ({ page }) => {
    await setup(page);
    await openForm(page);
    await expect(t(page, "catalogue")).toBeHidden();
    await expect(bar(page)).toBeHidden();
  });

  test("lists each basket entry with its name, units, a remove button and the likely outcome", async ({ page }) => {
    await setup(page);
    await openForm(page, [[KETTLE], [LAMP], [DUMBBELL, 2]]);
    const rows = t(page, "reserve-item");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-id", KETTLE); // basket order
    await expect(rows.nth(1)).toHaveAttribute("data-id", LAMP);
    await expect(rows.nth(2)).toHaveAttribute("data-id", DUMBBELL);
    await expect(rows.nth(0).getByTestId("reserve-item-name")).toContainText("Test Kettle");
    await expect(rows.nth(2).getByTestId("reserve-item-name")).toContainText("Test Dumbbell Set");
    await expect(rows.nth(0).getByTestId("reserve-item-units")).toHaveText("1");
    await expect(rows.nth(2).getByTestId("reserve-item-units")).toHaveText("2");
    for (const i of [0, 1, 2]) await expect(rows.nth(i).getByTestId("reserve-item-remove")).toBeVisible();
  });

  test("an item with free units reads as a reservation; an item with none free reads waiting list, position n", async ({ page }) => {
    await setup(page);
    await openForm(page, [[KETTLE], [LAMP], [DUMBBELL, 2]]);
    const outcome = (id: string) => page.locator(`[data-testid="reserve-item"][data-id="${id}"]`).getByTestId("reserve-item-outcome");
    await expect(outcome(KETTLE)).toHaveText(/reserve/i);
    await expect(outcome(KETTLE)).not.toHaveText(/waiting/i);
    await expect(outcome(DUMBBELL)).toHaveText(/reserve/i);
    await expect(outcome(DUMBBELL)).not.toHaveText(/waiting/i);
    // Lamp: 0 free, waitingCount 2, so the new person would be 3rd in line.
    await expect(outcome(LAMP)).toHaveText(/waiting list/i);
    await expect(outcome(LAMP)).toHaveText(/position 3/i);
    await expect(outcome(LAMP)).not.toHaveText(/\breserved?\b/i);
  });

  test("the outcome follows waitingCount (nobody waiting means position 1)", async ({ page }) => {
    const cat = [item({ id: "I-9501", name: "Test Radio", freeUnits: 0, unitsLeft: 1, waitingCount: 0 })];
    await setup(page, undefined, reserving(cat));
    await openForm(page, [["I-9501"]], 1);
    await expect(t(page, "reserve-item-outcome")).toHaveText(/position 1\b/i);
  });

  test("Remove takes the entry off the list and out of the basket, and the catalogue shows it", async ({ page }) => {
    await setup(page);
    await openForm(page, [[KETTLE], [NOVEL]]);
    await page.locator(`[data-testid="reserve-item"][data-id="${KETTLE}"]`).getByTestId("reserve-item-remove").click();
    await expect(t(page, "reserve-item")).toHaveCount(1);
    await expect(t(page, "reserve-item")).toHaveAttribute("data-id", NOVEL);
    await t(page, "reserve-back").click();
    await expect(row(page, KETTLE).getByTestId("add-button")).toHaveText("Add");
    await expect(page.getByTestId("basket-reserve")).toHaveText("Reserve (1)");
  });

  test("Remove takes away all units of a multi-unit entry", async ({ page }) => {
    await setup(page);
    await openForm(page, [[DUMBBELL, 3], [KETTLE]]);
    await page.locator(`[data-testid="reserve-item"][data-id="${DUMBBELL}"]`).getByTestId("reserve-item-remove").click();
    await t(page, "reserve-back").click();
    await expect(page.getByTestId("basket-reserve")).toHaveText("Reserve (1)");
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("0");
  });

  test("removing the last entry swaps the form for the friendly empty message", async ({ page }) => {
    await setup(page);
    await openForm(page);
    await t(page, "reserve-item-remove").click();
    await expect(t(page, "reserve-empty")).toBeVisible();
    await expect(t(page, "reserve-form")).toHaveCount(0);
  });

  test("an empty basket shows a friendly message and a link back, not the form", async ({ page }) => {
    await setup(page);
    await page.goto("/#/reserve");
    await expect(t(page, "reserve-empty")).toBeVisible();
    await expect(t(page, "reserve-empty")).toHaveText(/empty|nothing|no items/i);
    await expect(t(page, "reserve-form")).toHaveCount(0);
    await expect(t(page, "catalogue")).toBeHidden();
    await expect(t(page, "reserve-back")).toHaveAttribute("href", "#/");
    await t(page, "reserve-back").click();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(t(page, "reserve-empty")).toHaveCount(0);
  });

  test("the link back from the form returns to the catalogue with the basket intact", async ({ page }) => {
    await setup(page);
    await openForm(page, [[KETTLE], [DUMBBELL, 2]]);
    await t(page, "reserve-back").click();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(t(page, "reserve-form")).toHaveCount(0);
    await expect(page.getByTestId("basket-reserve")).toHaveText("Reserve (3)");
  });

  test("the browser Back button also returns to the catalogue", async ({ page }) => {
    await setup(page);
    await openForm(page);
    await page.goBack();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(t(page, "reserve-form")).toHaveCount(0);
  });

  test("a reload on #/reserve shows the same form and the same entries", async ({ page }) => {
    await setup(page);
    await openForm(page, [[KETTLE], [DUMBBELL, 2]]);
    await page.reload();
    await expect(t(page, "reserve-form")).toBeVisible();
    await expect(t(page, "reserve-item")).toHaveCount(2);
    await expect(page.locator(`[data-testid="reserve-item"][data-id="${DUMBBELL}"]`).getByTestId("reserve-item-units")).toHaveText("2");
  });

  for (const [label, body] of [
    ["reserving is false", { ...response(), reserving: false }],
    ["reserving is missing (an older response)", response()],
  ] as const) {
    test(`when ${label}, #/reserve shows the normal catalogue and no form (R1 unchanged)`, async ({ page }) => {
      const api = await setup(page, undefined, body);
      await page.goto("/#/reserve");
      await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
      await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(ITEMS.length);
      for (const id of ["reserve-form", "reserve-name", "reserve-number", "reserve-submit", "reserve-empty", "reserve-website"]) {
        await expect(t(page, id)).toHaveCount(0);
      }
      expect(api.sent).toHaveLength(0);
    });
  }
});

// ------------------------------------------------------------------ the fields

test.describe("fields, notice and honeypot", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    await openForm(page);
  });

  test("the name field is a text input with autocomplete=name and a label that says name", async ({ page }) => {
    const f = t(page, "reserve-name");
    await expect(f).toHaveAttribute("autocomplete", "name");
    expect(await f.evaluate((e) => (e as HTMLInputElement).type)).toBe("text");
    const labels = await f.evaluate((e) => [...(e as HTMLInputElement).labels!].map((l) => l.textContent ?? ""));
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels.join(" ")).toMatch(/name/i);
  });

  test("the number field is type=tel with autocomplete=tel and a label that says phone or number", async ({ page }) => {
    const f = t(page, "reserve-number");
    await expect(f).toHaveAttribute("type", "tel");
    await expect(f).toHaveAttribute("autocomplete", "tel");
    const labels = await f.evaluate((e) => [...(e as HTMLInputElement).labels!].map((l) => l.textContent ?? ""));
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels.join(" ")).toMatch(/phone|number|whatsapp/i);
  });

  test("the form turns off browser validation so our own messages are the ones shown", async ({ page }) => {
    expect(await t(page, "reserve-form").evaluate((e) => (e as HTMLFormElement).noValidate)).toBe(true);
    expect(await t(page, "reserve-form").evaluate((e) => e.tagName)).toBe("FORM");
  });

  test("shows the brief 6.4 notice word for word", async ({ page }) => {
    await expect(t(page, "reserve-notice")).toContainText(NOTICE);
    await expect(page.getByText(NOTICE, { exact: true })).toBeVisible();
  });

  test("the honeypot follows the S-11 markup and is not visible to a person", async ({ page }) => {
    const hp = t(page, "reserve-website");
    await expect(hp).toHaveAttribute("autocomplete", "off");
    await expect(hp).toHaveAttribute("tabindex", "-1");
    await expect(hp).toHaveAttribute("aria-hidden", "true");
    const name = await hp.getAttribute("name");
    expect(name, "needs a name attribute").toBeTruthy();
    expect(["website", "url", "email", "name", "phone", "tel", "homepage", "address"]).not.toContain(name!.toLowerCase());
    const s = await hp.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { w: r.width, h: r.height, left: r.left, right: r.right, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, vw: innerWidth };
    });
    expect(s.display).not.toBe("none"); // display:none is what bots look for
    expect(s.visibility).not.toBe("hidden");
    const hidden = (s.w <= 2 && s.h <= 2) || s.right <= 0 || s.left >= s.vw || s.opacity === "0";
    expect(hidden, `honeypot must be visually hidden: ${JSON.stringify(s)}`).toBe(true);
  });

  test("tabbing from the name field goes to the number field, never to the honeypot", async ({ page, browserName }) => {
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
    await t(page, "reserve-name").focus();
    await page.keyboard.press(tab);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("reserve-number");
  });

  test("fields are at least 44 px tall and so are the submit button and the link back", async ({ page }) => {
    for (const id of ["reserve-name", "reserve-number", "reserve-submit", "reserve-back", "reserve-item-remove"]) {
      await expectTap(t(page, id).first(), id);
    }
  });
});

// ------------------------------------------------------------------ validation

test.describe("validation (brief 6.3): errors beside the fields, input kept, nothing sent", () => {
  let api: Api;
  test.beforeEach(async ({ page }) => {
    api = await setup(page);
    await openForm(page);
  });

  test("an empty form shows both errors, sends nothing, and focuses the first invalid field", async ({ page }) => {
    await submit(page);
    await expect(t(page, "reserve-name-error")).toBeVisible();
    await expect(t(page, "reserve-number-error")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("reserve-name");
    expect(api.sent).toHaveLength(0);
    expect(await hash(page)).toBe("#/reserve");
  });

  for (const [label, name] of [["empty", ""], ["one character", "A"], ["spaces around one character", "   A   "], ["whitespace only", "     "], ["61 characters", "x".repeat(61)]] as const) {
    test(`refuses a name that is ${label}; the error says so in words and is tied to the field`, async ({ page }) => {
      await fill(page, name, NUMBER);
      await submit(page);
      const err = t(page, "reserve-name-error");
      await expect(err).toBeVisible();
      await expect(err).toHaveText(/name/i);
      await expect(t(page, "reserve-name")).toHaveAttribute("aria-invalid", "true");
      const ties = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="reserve-name"]')!;
        const e = document.querySelector('[data-testid="reserve-name-error"]')!;
        return !!e.id && (input.getAttribute("aria-describedby") ?? "").split(/\s+/).includes(e.id);
      });
      expect(ties, "aria-describedby names the error element").toBe(true);
      await expect(t(page, "reserve-number-error")).toHaveCount(0); // the number was fine
      await expect(t(page, "reserve-number")).not.toHaveAttribute("aria-invalid", "true");
      expect(api.sent).toHaveLength(0);
      await expect(t(page, "reserve-number")).toHaveValue(NUMBER); // input kept
    });
  }

  for (const [label, name, sent] of [["2 characters", "Al", "Al"], ["60 characters", "x".repeat(60), "x".repeat(60)], ["padded with spaces", `   ${NAME}  `, NAME]] as const) {
    test(`accepts a name that is ${label}, and sends it trimmed`, async ({ page }) => {
      await fill(page, name, NUMBER);
      await submit(page);
      await expectBooked(page);
      expect(api.sent).toHaveLength(1);
      expect(api.sent[0]!.body.name).toBe(sent);
    });
  }

  const BAD_NUMBERS: [string, string][] = [
    ["empty", ""],
    ["too short", "12345"],
    ["letters", "call me maybe"],
    ["eleven digits with a leading 0 (trunk 0)", ["0", "90000", "00012"].join(" ")],
    ["+91 followed by a trunk 0", ["+91", "0", "90000", "00012"].join(" ")],
    ["a plus in the middle", "9000+000012"],
  ];
  for (const [label, num] of BAD_NUMBERS) {
    test(`refuses a number that is ${label}, beside the number field, keeping what was typed`, async ({ page }) => {
      expect(normalisePhone(num), "table must agree with the shared phone rules").toBeNull();
      await fill(page, NAME, num);
      await submit(page);
      await expect(t(page, "reserve-number-error")).toBeVisible();
      await expect(t(page, "reserve-number-error")).toHaveText(/number|phone/i);
      await expect(t(page, "reserve-number")).toHaveAttribute("aria-invalid", "true");
      expect(await page.evaluate(() => {
        const input = document.querySelector('[data-testid="reserve-number"]')!;
        const e = document.querySelector('[data-testid="reserve-number-error"]')!;
        return !!e.id && (input.getAttribute("aria-describedby") ?? "").split(/\s+/).includes(e.id);
      })).toBe(true);
      await expect(t(page, "reserve-name-error")).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("reserve-number");
      await expect(t(page, "reserve-number")).toHaveValue(num);
      await expect(t(page, "reserve-name")).toHaveValue(NAME);
      expect(api.sent).toHaveLength(0);
    });
  }

  for (const num of ["919000000012", "91 90000 00012"]) {
    test(`"${num}" (91 and ten digits, no +) is refused with a hint to add a +`, async ({ page }) => {
      expect(normalisePhone(num)).toBeNull();
      await fill(page, NAME, num);
      await submit(page);
      await expect(t(page, "reserve-number-error")).toContainText("+");
      expect(api.sent).toHaveLength(0);
    });
  }

  test("the add-a-+ hint appears only for 91 plus ten digits, not for other bad numbers", async ({ page }) => {
    await fill(page, NAME, "12345");
    await submit(page);
    await expect(t(page, "reserve-number-error")).toBeVisible();
    await expect(t(page, "reserve-number-error")).not.toContainText("+");
  });

  const GOOD: [string, string][] = [
    ["ten digits", "90000 00012"],
    ["+91 with spaces", "+91 90000 00012"],
    ["+91 with hyphens", "+91-90000-00012"],
  ];
  for (const [label, num] of GOOD) {
    test(`accepts ${label} and sends it as ${E164}`, async ({ page }) => {
      await fill(page, NAME, num);
      await submit(page);
      await expectBooked(page);
      expect(normalisePhone(String(api.sent[0]!.body.number))).toBe(E164); // site and API agree on the number
    });
  }

  test("accepts an international number with a + and sends the same value normalisePhone gives", async ({ page }) => {
    const gb = ["+44", "7700", "900123"].join(" ");
    await fill(page, NAME, gb);
    await submit(page);
    await expectBooked(page);
    expect(normalisePhone(String(api.sent[0]!.body.number))).toBe(normalisePhone(gb));
  });

  test("fixing the one bad field clears its error and the next submit goes through", async ({ page }) => {
    await fill(page, "A", NUMBER);
    await submit(page);
    await expect(t(page, "reserve-name-error")).toBeVisible();
    await t(page, "reserve-name").fill(NAME);
    await submit(page);
    await expectBooked(page);
    expect(api.sent).toHaveLength(1);
  });

  test("when both fields are wrong, fixing one leaves the other error showing", async ({ page }) => {
    await fill(page, "", "12345");
    await submit(page);
    await t(page, "reserve-name").fill(NAME);
    await submit(page);
    await expect(t(page, "reserve-name-error")).toHaveCount(0);
    await expect(t(page, "reserve-number-error")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("reserve-number");
  });

  test("an error sits right beside its field: the name error between the two fields, the number error just under the number", async ({ page }) => {
    await fill(page, "", "12345");
    await submit(page);
    const n = (await t(page, "reserve-name").boundingBox())!;
    const ne = (await t(page, "reserve-name-error").boundingBox())!;
    const p = (await t(page, "reserve-number").boundingBox())!;
    const pe = (await t(page, "reserve-number-error").boundingBox())!;
    expect(ne.y).toBeGreaterThanOrEqual(n.y + n.height - 1);
    expect(ne.y + ne.height).toBeLessThanOrEqual(p.y + 1);
    expect(pe.y).toBeGreaterThanOrEqual(p.y + p.height - 1);
    expect(pe.y - (p.y + p.height)).toBeLessThan(80);
  });
});

// ------------------------------------------------------------------ the request

test.describe("the request (4.3, S-11 notes)", () => {
  test("is a text/plain JSON POST to the API URL with no query string and exactly the agreed fields", async ({ page }) => {
    const api = await setup(page);
    await openForm(page, [[KETTLE], [LAMP], [DUMBBELL, 2]]);
    await fill(page);
    await submit(page);
    await expectBooked(page);
    expect(api.sent).toHaveLength(1);
    const s = api.sent[0]!;
    expect(s.method).toBe("POST");
    expect(s.url).toBe(API_URL);
    expect(new URL(s.url).search).toBe("");
    expect(s.contentType).toMatch(/^text\/plain/i);
    expect(api.others, "no preflight or other methods").toEqual([]);
    expect(Object.keys(s.body).sort()).toEqual(["action", "idempotencyKey", "items", "name", "number", "website"]);
    expect(s.body.action).toBe("reserve");
    expect(s.body.name).toBe(NAME);
    expect(normalisePhone(String(s.body.number))).toBe(E164);
    expect(s.body.website).toBe("");
    expect(s.body.items).toEqual([
      { id: KETTLE, quantity: 1 },
      { id: LAMP, quantity: 1 },
      { id: DUMBBELL, quantity: 2 },
    ]);
  });

  test("items reflect removals made on the form", async ({ page }) => {
    const api = await setup(page);
    await openForm(page, [[KETTLE], [NOVEL]]);
    await page.locator(`[data-testid="reserve-item"][data-id="${KETTLE}"]`).getByTestId("reserve-item-remove").click();
    await fill(page);
    await submit(page);
    await expectBooked(page);
    expect(api.sent[0]!.body.items).toEqual([{ id: NOVEL, quantity: 1 }]);
  });

  test("the idempotency key matches the server pattern and carries at least 128 bits", async ({ page }) => {
    const api = await setup(page);
    await openForm(page);
    await fill(page);
    await submit(page);
    await expectBooked(page);
    const key = String(api.sent[0]!.body.idempotencyKey);
    expect(key).toMatch(KEY_RE);
    expect(key.length).toBeGreaterThanOrEqual(22); // 128 bits at no more than 6 bits per character
  });

  test("a filled honeypot is sent as `website` unchanged", async ({ page }) => {
    const api = await setup(page);
    await openForm(page);
    await fill(page);
    await t(page, "reserve-website").evaluate((e) => { (e as HTMLInputElement).value = "http://spam.invalid"; });
    await submit(page);
    await expect.poll(() => api.sent.length).toBe(1);
    expect(api.sent[0]!.body.website).toBe("http://spam.invalid");
  });

  test("a new form (after a booking) gets a new key, even if Math.random is stuck", async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.5; });
    const api = await setup(page);
    await openForm(page);
    await fill(page);
    await submit(page);
    await expectBooked(page);
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await addItem(page, NOVEL);
    await page.getByTestId("basket-reserve").click();
    await expect(t(page, "reserve-form")).toBeVisible();
    await fill(page);
    await submit(page);
    await expect.poll(() => api.sent.length).toBe(2);
    const [a, b] = api.sent.map((s) => String(s.body.idempotencyKey));
    expect(a).toMatch(KEY_RE);
    expect(b).toMatch(KEY_RE);
    expect(a).not.toBe(b);
  });
});

// ------------------------------------------------------------------ pending, success

test.describe("saving state and success", () => {
  test("while the request is pending the button is disabled with a Saving status, and a second submit sends nothing", async ({ page }) => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const api = await setup(page, async (route) => { await gate; await json(SUCCESS)(route); });
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-submit")).toBeDisabled();
    await expect(t(page, "reserve-status")).toBeVisible();
    await expect(t(page, "reserve-status")).toHaveText(/saving/i);
    expect(await t(page, "reserve-status").getAttribute("role")).toBe("status");
    // A second submit by any route (Enter key, script) must not send again.
    await t(page, "reserve-form").evaluate((f) => (f as HTMLFormElement).requestSubmit());
    await t(page, "reserve-number").press("Enter");
    await page.waitForTimeout(300);
    expect(api.sent).toHaveLength(1);
    open();
    await expectBooked(page);
    expect(api.sent).toHaveLength(1);
  });

  test("on success the basket is cleared and the site goes to #/b/<token>", async ({ page }) => {
    await setup(page);
    await openForm(page, [[KETTLE], [DUMBBELL, 2]]);
    await fill(page);
    await submit(page);
    await expectBooked(page);
    await page.evaluate(() => { location.hash = "#/"; });
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(bar(page)).toHaveCount(0);
    await expect(row(page, KETTLE).getByTestId("add-button")).toHaveText("Add");
    await expect(row(page, DUMBBELL).getByTestId("stepper-count")).toHaveText("0");
    // and still empty after a reload (storage was cleared, not just the view)
    await page.reload();
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await expect(bar(page)).toHaveCount(0);
  });

  test("the token is never in a query string, in the page URL's query, or in a localStorage key name", async ({ page }) => {
    const api = await setup(page);
    await openForm(page);
    await fill(page);
    await submit(page);
    await expectBooked(page);
    expect(new URL(page.url()).search).toBe("");
    for (const s of api.sent) expect(s.url).not.toContain(TOKEN);
    for (const { key } of await storage(page)) expect(key).not.toContain(TOKEN);
  });

  test("a booking with some items skipped (ok:true, skipped non-empty) still goes to the booking page", async ({ page }) => {
    await setup(page, reply({ ...SUCCESS, skipped: [{ id: LAMP, name: "Test Lamp", reason: "sold-out" }] }));
    await openForm(page, [[KETTLE], [LAMP]]);
    await fill(page);
    await submit(page);
    await expectBooked(page);
  });

  test("a booking without a WhatsApp link (whatsappUrl null) still succeeds", async ({ page }) => {
    await setup(page, reply({ ...SUCCESS, whatsappUrl: null }));
    await openForm(page);
    await fill(page);
    await submit(page);
    await expectBooked(page);
  });
});

// ------------------------------------------------------------------ failures (T-15)

test.describe("failures keep the input and speak plainly (T-15)", () => {
  interface Case {
    label: string;
    post: PostHandler;
    where: "form" | "name" | "number";
    cue?: RegExp;
    reusesKey?: boolean; // default true
  }
  const fail = (error: string, extra: object = {}): PostHandler => reply({ ok: false, error, ...extra });
  const CASES: Case[] = [
    { label: "invalid-name", post: fail("invalid-name"), where: "name" },
    { label: "invalid-number", post: fail("invalid-number"), where: "number" },
    { label: "invalid-basket", post: fail("invalid-basket"), where: "form", cue: /item|basket|15/i },
    { label: "invalid-request", post: fail("invalid-request"), where: "form", cue: /try again|message/i, reusesKey: false },
    { label: "too-many-claims", post: fail("too-many-claims"), where: "form", cue: /too many|20|already/i },
    { label: "not-reserving", post: fail("not-reserving"), where: "form" },
    { label: "not-configured", post: fail("not-configured"), where: "form", cue: /try again|message/i },
    { label: "busy", post: fail("busy"), where: "form", cue: /busy|try again/i },
    { label: "unavailable (handler error)", post: reply({ error: "unavailable" }), where: "form", cue: /try again/i },
    { label: "bad request (handler error)", post: reply({ error: "bad request" }), where: "form", cue: /try again|message/i },
    { label: "unknown action (handler error)", post: reply({ error: "unknown action" }), where: "form", cue: /try again|message/i },
    { label: "a network failure", post: networkDown, where: "form", cue: /try again/i },
    { label: "an HTTP 500", post: serverError, where: "form", cue: /try again/i },
    { label: "an HTML sign-in page instead of JSON", post: htmlPage, where: "form", cue: /try again/i },
    { label: "an empty JSON object", post: reply({}), where: "form", cue: /try again/i },
  ];

  for (const c of CASES) {
    test(`${c.label}: a friendly message ${c.where === "form" ? "on the form" : `beside the ${c.where} field`}, input kept, retry possible`, async ({ page }) => {
      const api = await setup(page, c.post);
      await openForm(page);
      await fill(page);
      await submit(page);
      await expect.poll(() => api.sent.length).toBe(1);
      const el = c.where === "form" ? t(page, "reserve-error") : t(page, `reserve-${c.where}-error`);
      await expect(el).toBeVisible();
      const text = (await el.textContent()) ?? "";
      expect(text.trim().length).toBeGreaterThan(15); // a sentence, not a code
      expect(text).not.toMatch(/undefined|null|\[object/);
      // The server's code words are for us, not for the buyer.
      expect(text.toLowerCase()).not.toMatch(/invalid-|too-many-claims|nothing-available|not-reserving|not-configured|unknown action|bad request/);
      if (c.cue) expect(text).toMatch(c.cue);
      if (c.where === "form") expect(await el.getAttribute("role")).toBe("alert");
      else await expect(t(page, `reserve-${c.where}`)).toHaveAttribute("aria-invalid", "true");
      // Input kept, still on the form, button usable again, no pending text left.
      expect(await hash(page)).toBe("#/reserve");
      await expect(t(page, "reserve-name")).toHaveValue(NAME);
      await expect(t(page, "reserve-number")).toHaveValue(NUMBER);
      await expect(t(page, "reserve-item")).toHaveCount(1);
      await expect(t(page, "reserve-submit")).toBeEnabled();
      await expect(t(page, "reserve-status")).toBeHidden();
      // A retry sends again (the buyer is not locked out) and, T-15, with the same idempotency key.
      await submit(page);
      await expect.poll(() => api.sent.length).toBe(2);
      if (c.reusesKey !== false) expect(api.sent[1]!.body.idempotencyKey).toBe(api.sent[0]!.body.idempotencyKey);
      expect(String(api.sent[0]!.body.idempotencyKey)).toMatch(KEY_RE);
    });
  }

  test("the same key is reused when the buyer corrects the number and retries after a server rejection", async ({ page }) => {
    const api = await setup(page, fail("invalid-number"));
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-number-error")).toBeVisible();
    api.setPost(reply(SUCCESS));
    await t(page, "reserve-number").fill("+91 90000 00013");
    await submit(page);
    await expectBooked(page);
    expect(api.sent).toHaveLength(2);
    expect(api.sent[1]!.body.idempotencyKey).toBe(api.sent[0]!.body.idempotencyKey);
    // the field message goes away once the booking is through; and the new number was what got sent
    expect(normalisePhone(String(api.sent[1]!.body.number))).toBe("+919000000013");
  });

  test("a failed attempt followed by success books once, with the key of the first attempt", async ({ page }) => {
    const api = await setup(page, networkDown);
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-error")).toBeVisible();
    api.setPost(reply(SUCCESS));
    await submit(page);
    await expectBooked(page);
    expect(api.sent).toHaveLength(2);
    expect(api.sent[1]!.body.idempotencyKey).toBe(api.sent[0]!.body.idempotencyKey);
    expect(api.sent[1]!.body.items).toEqual(api.sent[0]!.body.items);
    await expect(t(page, "reserve-error")).toHaveCount(0);
  });

  test("the messages for different problems differ (not one generic line for everything)", async ({ page }) => {
    const api = await setup(page, fail("too-many-claims"));
    await openForm(page);
    await fill(page);
    const seen = new Map<string, string>();
    for (const code of ["too-many-claims", "not-reserving", "busy", "invalid-basket"]) {
      api.setPost(fail(code));
      const before = api.sent.length;
      await submit(page);
      await expect.poll(() => api.sent.length).toBe(before + 1);
      await expect(t(page, "reserve-submit")).toBeEnabled();
      await expect(t(page, "reserve-error")).toBeVisible();
      seen.set(code, ((await t(page, "reserve-error").textContent()) ?? "").trim());
    }
    expect(new Set(seen.values()).size, JSON.stringify([...seen.entries()])).toBe(4);
  });

  test("an old error is gone while the next attempt is pending", async ({ page }) => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const api = await setup(page, networkDown);
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-error")).toBeVisible();
    api.setPost(async (route) => { await gate; await json(SUCCESS)(route); });
    await submit(page);
    await expect(t(page, "reserve-status")).toBeVisible();
    await expect(t(page, "reserve-error")).toHaveCount(0);
    open();
    await expectBooked(page);
  });

  test("nothing-available names the skipped items, says why in words, and keeps the input", async ({ page }) => {
    await setup(page, fail("nothing-available", {
      skipped: [
        { id: KETTLE, name: "Test Kettle", reason: "sold-out" },
        { id: "I-9777", name: null, reason: "unavailable" },
      ],
    }));
    await openForm(page, [[KETTLE], [NOVEL]]);
    await fill(page);
    await submit(page);
    const list = t(page, "reserve-skipped");
    await expect(list).toBeVisible();
    await expect(t(page, "reserve-skipped-item")).toHaveCount(2);
    await expect(t(page, "reserve-skipped-item").first()).toContainText("Test Kettle");
    await expect(t(page, "reserve-skipped-item").first()).toHaveText(/sold/i);
    const second = (await t(page, "reserve-skipped-item").nth(1).textContent()) ?? "";
    expect(second).not.toMatch(/null|undefined/);
    expect(second.trim().length).toBeGreaterThan(3); // an unknown name still gets a sentence
    await expect(t(page, "reserve-error")).toBeVisible();
    await expect(t(page, "reserve-name")).toHaveValue(NAME);
    await expect(t(page, "reserve-number")).toHaveValue(NUMBER);
    expect(await hash(page)).toBe("#/reserve");
  });

  test("a request that never answers shows the pending state, then a try-again message after a while, with input kept", async ({ page }) => {
    await page.clock.install();
    const api = await setup(page, hang);
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-status")).toBeVisible();
    await page.clock.runFor(10_000); // a cold Apps Script start can take ~13 s (D-033): still waiting at 10 s
    await expect(t(page, "reserve-submit")).toBeDisabled();
    await page.clock.runFor(120_000);
    await expect(t(page, "reserve-error")).toBeVisible();
    await expect(t(page, "reserve-error")).toHaveText(/try again/i);
    await expect(t(page, "reserve-submit")).toBeEnabled();
    await expect(t(page, "reserve-name")).toHaveValue(NAME);
    await expect(t(page, "reserve-number")).toHaveValue(NUMBER);
    api.setPost(reply(SUCCESS));
    await submit(page);
    await expectBooked(page);
    expect(api.sent[1]!.body.idempotencyKey).toBe(api.sent[0]!.body.idempotencyKey);
  });
});

// ------------------------------------------------------------------ remembering

test.describe("name and number are remembered on the device, with a clear option", () => {
  async function bookOnce(page: Page, name = NAME, number = NUMBER): Promise<void> {
    await openForm(page);
    await fill(page, name, number);
    await submit(page);
    await expectBooked(page);
  }
  async function reopen(page: Page): Promise<void> {
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await addItem(page, NOVEL);
    await page.getByTestId("basket-reserve").click();
    await expect(t(page, "reserve-form")).toBeVisible();
  }

  test("after a booking the next form (after a full reload) starts with the saved name and number", async ({ page }) => {
    await setup(page);
    await bookOnce(page);
    await reopen(page);
    await expect(t(page, "reserve-name")).toHaveValue(NAME);
    expect(normalisePhone(await t(page, "reserve-number").inputValue())).toBe(E164);
    await expect(t(page, "reserve-forget")).toBeVisible();
  });

  test("a first-time visitor sees empty fields and no stale values", async ({ page }) => {
    await setup(page);
    await openForm(page);
    await expect(t(page, "reserve-name")).toHaveValue("");
    await expect(t(page, "reserve-number")).toHaveValue("");
  });

  test("the clear option removes the details from the device and from the fields", async ({ page }) => {
    await setup(page);
    await bookOnce(page);
    await reopen(page);
    await t(page, "reserve-forget").click();
    await expect(t(page, "reserve-name")).toHaveValue("");
    await expect(t(page, "reserve-number")).toHaveValue("");
    await expect(t(page, "reserve-forget")).toBeHidden();
    const dump = JSON.stringify(await storage(page));
    expect(dump).not.toContain("Asha");
    expect(dump).not.toContain("9000000012");
    expect(dump).not.toContain("90000 00012");
    await page.reload();
    await expect(t(page, "reserve-form")).toBeVisible();
    await expect(t(page, "reserve-name")).toHaveValue("");
    await expect(t(page, "reserve-number")).toHaveValue("");
  });

  test("the clear option is a proper tap target", async ({ page }) => {
    await setup(page);
    await bookOnce(page);
    await reopen(page);
    await expectTap(t(page, "reserve-forget"), "reserve-forget");
  });

  test("the honeypot value is not saved or prefilled", async ({ page }) => {
    await setup(page);
    await openForm(page);
    await fill(page);
    await t(page, "reserve-website").evaluate((e) => { (e as HTMLInputElement).value = "http://spam.invalid"; });
    await submit(page);
    await expectBooked(page);
    expect(JSON.stringify(await storage(page))).not.toContain("spam.invalid");
  });

  test("with localStorage and sessionStorage blocked the whole journey still works, with no page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const deny = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: deny, configurable: true });
      Object.defineProperty(window, "sessionStorage", { get: deny, configurable: true });
    });
    const api = await setup(page);
    await openForm(page, [[KETTLE], [DUMBBELL, 2]]);
    await expect(t(page, "reserve-item")).toHaveCount(2);
    await fill(page);
    await submit(page);
    await expectBooked(page);
    expect(api.sent[0]!.body.items).toEqual([{ id: KETTLE, quantity: 1 }, { id: DUMBBELL, quantity: 2 }]);
    expect(errors).toEqual([]);
  });

  test("with storage blocked, a failed attempt still keeps the typed input on screen", async ({ page }) => {
    await page.addInitScript(() => {
      const deny = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: deny, configurable: true });
    });
    await setup(page, networkDown);
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-error")).toBeVisible();
    await expect(t(page, "reserve-name")).toHaveValue(NAME);
    await expect(t(page, "reserve-number")).toHaveValue(NUMBER);
  });
});

// ------------------------------------------------------------------ inert text (T-10)

test.describe("text is inert (T-10)", () => {
  const MARKUP = "<img src=x onerror=window.__pwned=1>";
  const EVIL = [
    item({ id: "I-9401", name: MARKUP }),
    item({ id: "I-9402", name: "Test Scarf" }),
  ];

  test("an item name with markup in the list is shown as text and runs nothing", async ({ page }) => {
    await setup(page, undefined, reserving(EVIL));
    await openForm(page, [["I-9401"]], EVIL.length);
    await expect(t(page, "reserve-item-name")).toHaveText(MARKUP);
    expect(await page.locator("main img, [data-testid^='reserve'] img").count()).toBe(0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("a typed name that looks like markup or a formula is sent exactly as typed and stays text on screen", async ({ page }) => {
    const api = await setup(page, networkDown);
    await openForm(page);
    await fill(page, MARKUP, NUMBER);
    await submit(page);
    await expect(t(page, "reserve-error")).toBeVisible();
    await expect(t(page, "reserve-name")).toHaveValue(MARKUP);
    expect(api.sent[0]!.body.name).toBe(MARKUP);
    api.setPost(reply(SUCCESS));
    await t(page, "reserve-name").fill("=1+1");
    await submit(page);
    await expectBooked(page);
    expect(api.sent[1]!.body.name).toBe("=1+1"); // no apostrophe: the guard belongs to the sheet writer
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator("img[src='x']").count()).toBe(0);
  });

  test("a remembered name that looks like markup is prefilled as a value, not parsed", async ({ page }) => {
    await setup(page);
    await openForm(page);
    await fill(page, MARKUP, NUMBER);
    await submit(page);
    await expectBooked(page);
    await page.goto("/");
    await expect(page.getByTestId("item-row")).toHaveCount(ITEMS.length);
    await addItem(page, NOVEL);
    await page.getByTestId("basket-reserve").click();
    await expect(t(page, "reserve-name")).toHaveValue(MARKUP);
    expect(await page.locator("img[src='x']").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("skipped item names from the server are shown as text and run nothing", async ({ page }) => {
    await setup(page, reply({ ok: false, error: "nothing-available", skipped: [{ id: "I-9401", name: MARKUP, reason: "sold-out" }] }));
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-skipped-item").first()).toContainText(MARKUP);
    expect(await page.locator("img[src='x']").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("a server error string is never echoed into the page", async ({ page }) => {
    await setup(page, reply({ ok: false, error: "<b data-testid='injected'>x</b>" }));
    await openForm(page);
    await fill(page);
    await submit(page);
    await expect(t(page, "reserve-error")).toBeVisible();
    await expect(t(page, "injected")).toHaveCount(0);
    await expect(t(page, "reserve-error")).not.toContainText("injected");
  });
});

// ------------------------------------------------------------------ phone widths

test.describe("fits small phones and does not rely on colour", () => {
  const LONG = [
    item({ id: "I-9601", name: "Test Extraordinarily Long Item Name With Many Words To Wrap Around The Narrow Screen Twice" }),
    ...ITEMS,
  ];

  for (const width of [390, 320]) {
    test(`at ${width} px nothing scrolls sideways and every control is inside the screen, with errors showing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await setup(page, undefined, reserving(LONG));
      await openForm(page, [["I-9601"], [LAMP], [DUMBBELL, 3]], LONG.length);
      await fill(page, "", "12345");
      await submit(page); // both errors visible
      await expect(t(page, "reserve-name-error")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const id of ["reserve-name", "reserve-number", "reserve-submit", "reserve-name-error", "reserve-number-error", "reserve-back"]) {
        const b = (await t(page, id).first().boundingBox())!;
        expect(b.x, id).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, id).toBeLessThanOrEqual(width + 0.5);
      }
      for (const rm of await t(page, "reserve-item-remove").all()) await expectTap(rm, "remove");
      await t(page, "reserve-submit").scrollIntoViewIfNeeded();
      await expectTap(t(page, "reserve-submit"), "submit");
    });
  }

  test("outcome and error state are carried by words, not only colour", async ({ page }) => {
    await setup(page);
    await openForm(page, [[KETTLE], [LAMP]]);
    await submit(page);
    for (const id of ["reserve-name-error", "reserve-number-error"]) {
      expect(((await t(page, id).textContent()) ?? "").trim().length, id).toBeGreaterThan(10);
    }
    for (const o of await t(page, "reserve-item-outcome").all()) {
      expect(((await o.textContent()) ?? "").trim().length).toBeGreaterThan(5);
    }
    await expect(t(page, "reserve-name")).toHaveAttribute("aria-invalid", "true"); // state for assistive tech too
  });
});
