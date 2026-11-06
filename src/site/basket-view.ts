// S-09 basket UI (brief 7, D-038 rule 6). Owns the basket state, its localStorage copy, the per-row
// Add / stepper control and the sticky bar. Active only when the catalogue says `reserving === true`;
// otherwise it does nothing and the page behaves exactly as in R1.
import type { CatalogueItem } from "../api/catalogue";
import {
  MAX_BASKET_UNITS, basketLabel, emptyBasket, maxUnitsFor, parseBasket, pruneBasket, serializeBasket,
  setUnits, totalUnits, unitsOf, type Basket, type Refusal,
} from "./basket";
import { el } from "./dom";

const BASKET_KEY = "medley-sale:basket:v1";

// Storage may be blocked (T-14) or corrupt: every access is guarded and the basket then lives for the session only.
function readStored(): Basket {
  try {
    return parseBasket(localStorage.getItem(BASKET_KEY));
  } catch {
    return emptyBasket();
  }
}

function writeStored(b: Basket): void {
  try {
    localStorage.setItem(BASKET_KEY, serializeBasket(b));
  } catch {
    /* blocked or full: the basket still works for this session */
  }
}

function refusalText(r: Refusal): string | null {
  if (r === "basket-limit") return `You can reserve up to ${MAX_BASKET_UNITS} items at a time. Remove one to add another.`;
  if (r === "item-limit") return "That's all that's available of this item.";
  return null; // "invalid" cannot come from our own buttons
}

export interface BasketView {
  /** Call with every catalogue shown (cached or live), BEFORE building rows. */
  sync(items: readonly CatalogueItem[], reserving: boolean): void;
  /** The Add / stepper control for a row, or null outside reserving mode. */
  control(item: CatalogueItem): HTMLElement | null;
}

export function createBasketView(): BasketView {
  let active = false;
  let basket = readStored();
  let message: string | null = null;
  let bar: HTMLElement | null = null;
  const updaters = new Map<string, () => void>(); // item id -> refresh its control

  function persistAndRender(): void {
    writeStored(basket);
    for (const u of updaters.values()) u();
    renderBar();
  }

  // Applies a change; a refusal leaves the basket as it was and shows the message.
  function change(id: string, units: number, max: number): void {
    const r = setUnits(basket, id, units, max);
    basket = r.basket;
    message = r.refused ? refusalText(r.refused) : null;
    persistAndRender();
  }

  // The bar exists only while something is selected (brief 7). Button text carries the count, so
  // nothing depends on colour.
  function renderBar(): void {
    if (!active || totalUnits(basket) === 0) {
      bar?.remove();
      bar = null;
      return;
    }
    if (!bar) {
      bar = el("div", undefined, "basket-bar", "basket-bar");
      document.body.append(bar);
    }
    const inner = el("div", undefined, "basket-bar-inner");
    if (message) {
      const m = el("p", message, "basket-message", "basket-message");
      m.setAttribute("role", "alert");
      inner.append(m);
    }
    const go = el("a", basketLabel(basket), "basket-reserve", "basket-reserve");
    go.href = "#/reserve"; // S-10 builds that screen
    inner.append(go);
    bar.replaceChildren(inner);
  }

  function control(item: CatalogueItem): HTMLElement | null {
    if (!active) return null;
    const max = maxUnitsFor(item);
    const waiting = item.freeUnits <= 0;
    const wrap = el("div", undefined, "basket-control");
    if (max > 1) {
      // Stepper replaces Add; its upper limit is the FREE units, not the stock.
      const stepper = el("div", undefined, "stepper", "stepper");
      stepper.setAttribute("role", "group");
      stepper.setAttribute("aria-label", `Quantity of ${item.name}`);
      const dec = el("button", "−", "step", "stepper-dec");
      dec.type = "button";
      dec.setAttribute("aria-label", "Remove one");
      const count = el("span", "0", "step-count", "stepper-count");
      count.setAttribute("aria-live", "polite");
      const inc = el("button", "+", "step", "stepper-inc");
      inc.type = "button";
      inc.setAttribute("aria-label", "Add one");
      dec.addEventListener("click", () => change(item.id, unitsOf(basket, item.id) - 1, max));
      inc.addEventListener("click", () => change(item.id, unitsOf(basket, item.id) + 1, max));
      stepper.append(dec, count, inc);
      wrap.append(stepper);
      updaters.set(item.id, () => {
        const n = unitsOf(basket, item.id);
        count.textContent = String(n);
        dec.disabled = n <= 0;
        inc.disabled = n >= max;
      });
    } else {
      const add = el("button", undefined, "add", "add-button");
      add.type = "button";
      add.addEventListener("click", () => change(item.id, unitsOf(basket, item.id) > 0 ? 0 : 1, max));
      wrap.append(add);
      // Selected state is words plus a tick, never colour alone (brief 7).
      updaters.set(item.id, () => {
        const on = unitsOf(basket, item.id) > 0;
        add.textContent = waiting ? (on ? "On waiting list ✓" : "Join waiting list") : (on ? "Added ✓" : "Add");
        add.setAttribute("aria-pressed", String(on));
      });
    }
    updaters.get(item.id)?.();
    return wrap;
  }

  return {
    control,
    sync(items, reserving) {
      active = reserving;
      document.body.classList.toggle("reserving", reserving);
      updaters.clear(); // rows are about to be rebuilt
      if (reserving) {
        // Items that left the catalogue drop silently; units shrink to what is free now.
        basket = pruneBasket(basket, items);
        writeStored(basket);
      }
      renderBar();
    },
  };
}
