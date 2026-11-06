// S-10 reservation screen at #/reserve (brief 6.3, 6.4, 7; D-014; S-11 request notes). Shows the basket with
// its likely outcomes, the name/number form, and sends the booking. All text goes in via textContent, and
// the server's own error text is never shown (see interpretReply). The catalogue module owns routing.
import type { CatalogueItem } from "../api/catalogue";
import type { Basket } from "./basket";
import type { BasketView } from "./basket-view";
import { postJson } from "./api-post";
import { el } from "./dom";
import {
  KEY_PATTERN, NOT_SURE, checkNumber, interpretReply, newIdempotencyKey, validateName, type Failure,
} from "./reserve-form";

const BUYER_KEY = "medley-sale:buyer:v1"; // localStorage: remembered name and number (brief 6.3)
const IDEM_KEY = "medley-sale:idempotency:v1"; // sessionStorage: kept until a booking succeeds (PM, S-10)
const BOOKING_KEY = "medley-sale:last-booking:v1"; // sessionStorage: the success answer for S-12, NOT keyed by the token
const TIMEOUT_MS = 30_000; // PM: a cold Apps Script start takes ~13 s (D-033), so wait well past that
const NOTICE = "Your number is only seen by the seller and is used only for this sale."; // brief 6.4

// ---- storage (always guarded: it may be blocked, T-14) ----

function readBuyer(): { name: string; number: string } | null {
  try {
    const o = JSON.parse(localStorage.getItem(BUYER_KEY) ?? "null") as { name?: unknown; number?: unknown } | null;
    return o && typeof o.name === "string" && typeof o.number === "string" ? { name: o.name, number: o.number } : null;
  } catch {
    return null;
  }
}

function writeBuyer(name: string, number: string): void {
  try {
    localStorage.setItem(BUYER_KEY, JSON.stringify({ name, number }));
  } catch {
    /* blocked or full: nothing is remembered */
  }
}

function forgetBuyer(): void {
  try {
    localStorage.removeItem(BUYER_KEY);
  } catch {
    /* blocked: nothing to clear */
  }
}

// The idempotency key survives reloads (sessionStorage) so a timed-out booking retried after a reload cannot
// book twice. If storage is blocked it lives in memory only.
let memoryKey: string | null = null;

function currentKey(): string {
  try {
    const stored = sessionStorage.getItem(IDEM_KEY);
    if (stored && KEY_PATTERN.test(stored)) return stored;
  } catch {
    if (memoryKey) return memoryKey;
  }
  return freshKey();
}

function freshKey(): string {
  const key = newIdempotencyKey();
  memoryKey = key;
  try {
    sessionStorage.setItem(IDEM_KEY, key);
  } catch {
    /* blocked: memory copy only */
  }
  return key;
}

function dropKey(): void {
  memoryKey = null;
  try {
    sessionStorage.removeItem(IDEM_KEY);
  } catch {
    /* blocked */
  }
}

function keepBooking(response: unknown): void {
  try {
    sessionStorage.setItem(BOOKING_KEY, JSON.stringify(response));
  } catch {
    /* blocked: S-12 will have to ask the server */
  }
}

// ---- network ----

const send = (body: object): Promise<unknown> => postJson(body, TIMEOUT_MS);

// ---- view ----

export interface ReserveScreen {
  /** Shows the screen (and builds the form on first use). */
  open(): void;
  /** Takes the screen out of the page; typed input is kept for the next open(). */
  close(): void;
  /** The latest catalogue items, for names and outcomes. */
  update(items: readonly CatalogueItem[]): void;
}

export function createReserveScreen(root: HTMLElement, basket: BasketView, onBooked: (token: string) => void): ReserveScreen {
  let items: readonly CatalogueItem[] = [];
  let form: HTMLFormElement | null = null; // kept while away so typed input survives Back
  let shown = false;
  // Fixed parts, so a live catalogue update replaces only the list and never the form (focus and typing survive).
  const back = el("a", "← Back to the sale", "back", "reserve-back");
  back.href = "#/";
  const heading = el("h2", "Your reservation");
  heading.tabIndex = -1; // focusable by script only: entering the form moves focus here (F4)
  let pendingBooking = false; // a booking is in flight: Remove is off, so what was sent stays what is in the basket (F2)
  const listBox = el("div");
  const tail = el("div"); // the form, or the empty message
  const empty = el("p", "Your basket is empty. Pick something from the sale first.", "note", "reserve-empty");

  function render(): void {
    if (!shown) return;
    const entries = basket.entries();
    listBox.replaceChildren(...(entries.length ? [itemList(entries)] : []));
    const want = entries.length ? (form ??= buildForm()) : empty;
    if (tail.firstChild !== want) tail.replaceChildren(want);
  }

  function itemList(entries: Basket): HTMLElement {
    const ul = el("ul", undefined, "reserve-items");
    ul.setAttribute("role", "list");
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const e of entries) {
      const item = byId.get(e.id);
      if (!item) continue;
      const li = el("li", undefined, "reserve-item", "reserve-item");
      li.dataset.id = e.id;
      const body = el("div", undefined, "body");
      body.append(el("p", item.name, "name", "reserve-item-name"));
      const qty = el("p", "Quantity: ", "sub");
      qty.append(el("span", String(e.units), undefined, "reserve-item-units"));
      body.append(qty);
      // Likely outcome in words (brief 7). The server decides in the end; this is the best guess from the list.
      const outcome = item.freeUnits > 0
        ? "Likely outcome: reserved for you."
        : `Likely outcome: you join the waiting list, position ${item.waitingCount + 1}.`;
      body.append(el("p", outcome, "status", "reserve-item-outcome"));
      const rm = el("button", "Remove", "remove", "reserve-item-remove");
      rm.type = "button";
      rm.disabled = pendingBooking;
      rm.setAttribute("aria-label", `Remove ${item.name}`);
      rm.addEventListener("click", () => {
        basket.remove(e.id);
        render();
      });
      li.append(body, rm);
      ul.append(li);
    }
    return ul;
  }

  function buildForm(): HTMLFormElement {
    const f = el("form", undefined, "reserve-form", "reserve-form");
    f.noValidate = true; // our own messages, not the browser's bubbles
    const saved = readBuyer();
    const name = field(f, "reserve-name", "Your name", "text", "name", saved?.name ?? "");
    const number = field(f, "reserve-number", "Your phone number (WhatsApp)", "tel", "tel", saved?.number ?? "");
    f.append(el("p", NOTICE, "note", "reserve-notice"));

    // Honeypot (S-11): a field a person never sees or tabs to. Hidden by CSS (public/style.css), not display:none.
    const trap = el("input", undefined, "hp", "reserve-website");
    trap.type = "text";
    trap.name = "a44-extra-note";
    trap.tabIndex = -1;
    trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    f.append(trap);

    const forget = el("button", "Forget my details on this device", "forget", "reserve-forget");
    forget.type = "button";
    forget.hidden = saved === null;
    forget.addEventListener("click", () => {
      forgetBuyer();
      name.value = "";
      number.value = "";
      forget.hidden = true;
    });

    const submit = el("button", "Reserve", "submit", "reserve-submit");
    submit.type = "submit";
    const status = el("p", "Saving…", "note", "reserve-status");
    status.setAttribute("role", "status");
    status.hidden = true;
    const messages = el("div"); // the form-level alert and the skipped list live here
    f.append(submit, status, messages, forget);

    let pending = false;

    function clearErrors(): void {
      for (const input of [name, number]) {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
        const next = input.nextElementSibling;
        if (next?.classList.contains("field-error")) next.remove();
      }
      messages.replaceChildren();
    }

    function fieldError(input: HTMLInputElement, text: string): void {
      const e = el("p", text, "field-error", `${input.dataset.testid}-error`);
      e.id = `${input.id}-error`;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", e.id);
      input.after(e);
    }

    function formError(fail: Extract<Failure, { kind: "form" }>): void {
      const box = el("div", undefined, "error", "reserve-error");
      box.setAttribute("role", "alert");
      box.append(el("p", fail.text));
      messages.replaceChildren(box);
      if (fail.skipped?.length) {
        const ul = el("ul", undefined, "skipped", "reserve-skipped");
        for (const s of fail.skipped) ul.append(el("li", `${s.name}: ${s.why}.`, undefined, "reserve-skipped-item"));
        box.append(ul);
      }
    }

    function setPending(on: boolean): void {
      pending = on;
      pendingBooking = on;
      render(); // rebuilds the list only, so Remove follows; the form and its focus stay
      submit.disabled = on;
      status.hidden = !on;
    }

    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (pending) return;
      clearErrors();
      const n = validateName(name.value);
      const p = checkNumber(number.value);
      if (!n.ok) fieldError(name, "Please enter your name, 2 to 60 characters.");
      if (!p.ok) {
        fieldError(number, p.needsPlus
          ? "Please add a + before the country code, for example +91 followed by your ten digits."
          : "That doesn't look like a valid phone number. Use 10 digits, or include the country code with a plus sign.");
      }
      if (!n.ok || !p.ok) {
        (n.ok ? number : name).focus();
        return;
      }
      void book(n.name, p.number, trap.value);
    });

    async function book(nameText: string, numberText: string, website: string): Promise<void> {
      setPending(true);
      let fail: Failure = NOT_SURE;
      const sentIds = basket.entries().map((e) => e.id);
      try {
        const reply = interpretReply(await send({
          action: "reserve",
          name: nameText,
          number: numberText,
          idempotencyKey: currentKey(),
          items: basket.entries().map((e) => ({ id: e.id, quantity: e.units })),
          website,
        }));
        if (reply.kind === "booked") {
          // Success: the key has done its job, remember the buyer, empty the basket, and hand over (S-12).
          dropKey();
          pendingBooking = false;
          writeBuyer(nameText, numberText);
          keepBooking(reply.response);
          // Only what was sent leaves the basket: an item added while this was in flight stays (F2).
          for (const id of sentIds) basket.remove(id);
          form = null; // the next reservation starts a fresh form
          onBooked(reply.token);
          return;
        }
        fail = reply;
      } catch {
        /* network failure, timeout or an unreadable answer: we cannot know it did not save, so keep the key */
      }
      if (fail.kind === "form" && fail.newKey) freshKey();
      setPending(false);
      if (fail.kind === "form") formError(fail);
      else {
        fieldError(fail.kind === "name" ? name : number, fail.text);
        (fail.kind === "name" ? name : number).focus();
      }
    }

    currentKey(); // generated when the form opens (brief 6.3)
    return f;
  }

  return {
    open() {
      if (shown) return; // a live list arriving must not re-mount the form: that would drop the focused input (F1)
      shown = true;
      root.replaceChildren(back, heading, listBox, tail);
      render();
      heading.focus();
    },
    close() {
      shown = false;
      root.replaceChildren();
    },
    update(next) {
      items = next;
      render();
    },
  };
}

/** A labelled input in its own block; the label is tied by for/id so a tap on it focuses the field. */
function field(f: HTMLFormElement, testid: string, label: string, type: string, autocomplete: string, value: string): HTMLInputElement {
  const wrap = el("div", undefined, "field");
  const input = el("input", undefined, undefined, testid);
  input.id = testid;
  input.type = type;
  input.setAttribute("autocomplete", autocomplete);
  input.value = value;
  const l = el("label", label);
  l.htmlFor = input.id;
  wrap.append(l, input);
  f.append(wrap);
  return input;
}
