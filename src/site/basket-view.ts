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
  /**
   * Call with every catalogue shown (cached or live), BEFORE building rows. `live` is false for the
   * cached render: that one prunes for display only (QA S-09 F4, D-038 rule 8).
   */
  sync(items: readonly CatalogueItem[], reserving: boolean, live: boolean): void;
  /** The Add / stepper control for a row, or null outside reserving mode. */
  control(item: CatalogueItem): HTMLElement | null;
  /** The entries as shown now (S-10 reservation screen). */
  entries(): Basket;
  /** Takes a whole entry out (S-10 Remove). */
  remove(id: string): void;
  /** Empties the basket, including entries a cached render hid (S-10, after a booking). */
  clear(): void;
  /** The reservation screen has its own submit button, so it hides the sticky bar (PM, S-10). */
  setBarHidden(hidden: boolean): void;
}

export function createBasketView(): BasketView {
  let active = false;
  let basket = readStored();
  let message: string | null = null;
  let bar: HTMLElement | null = null;
  // Entries a cached render hid because the (possibly stale) cached list lacks them. They are still in
  // storage and are kept there until a live response says whether they really left (QA S-09 F4).
  let hidden: Basket = [];
  // B3 (S-10): a cached render lowers displayed units to a possibly stale free count. The buyer's real
  // choice is kept here (id -> units) so storage is not lowered by an unrelated change; only a live render lowers it.
  const capped = new Map<string, number>();
  let barHidden = false;
  let watcher: ResizeObserver | null = null;
  const updaters = new Map<string, () => void>(); // item id -> refresh its control

  function persistAndRender(): void {
    writeStored([...basket.map((e) => ({ id: e.id, units: capped.get(e.id) ?? e.units })), ...hidden]);
    for (const u of updaters.values()) u();
    renderBar();
  }

  // Applies a change; a refusal leaves the basket as it was and shows the message.
  function change(id: string, units: number, max: number): void {
    const r = setUnits(basket, id, units, max);
    if (!r.refused) capped.delete(id); // the buyer has now chosen this count themselves
    basket = r.basket;
    message = r.refused ? refusalText(r.refused) : null;
    persistAndRender();
  }

  // Publishes the bar's real height as --bar-h on <html>; the CSS uses it for scroll-padding-bottom (and
  // main's bottom padding). The bar itself is position: sticky at the end of the page, so the end of the
  // list can never be covered whatever height it has: no script/layout race. Neither a refusal message
  // nor larger text can hide a row or a focused control behind the bar (QA S-09 F1, F2; D-038 rule 8). Set through the CSSOM because CSP is
  // `style-src 'self'` (no injected <style>). offsetHeight already includes the safe-area padding.
  function publishBarHeight(): void {
    document.documentElement.style.setProperty("--bar-h", `${bar?.offsetHeight ?? 0}px`);
  }

  // The bar exists only while something is selected (brief 7). Button text carries the count, so
  // nothing depends on colour.
  function renderBar(): void {
    if (!active || barHidden || totalUnits(basket) === 0) {
      bar?.remove();
      bar = null;
      watcher?.disconnect();
      publishBarHeight();
      return;
    }
    if (!bar) {
      bar = el("div", undefined, "basket-bar", "basket-bar");
      document.body.append(bar);
      // Also catches height changes that do not come through a render (text zoom, rotation, wrapping).
      if (typeof ResizeObserver !== "undefined") {
        watcher ??= new ResizeObserver(publishBarHeight);
        watcher.observe(bar);
      }
    }
    const inner = el("div", undefined, "basket-bar-inner");
    if (message) {
      const m = el("p", message, "basket-message", "basket-message");
      m.setAttribute("role", "alert");
      inner.append(m);
    }
    const go = el("a", basketLabel(basket), "basket-reserve", "basket-reserve");
    go.href = "#/reserve";
    inner.append(go);
    bar.replaceChildren(inner);
    publishBarHeight();
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
    entries: () => basket,
    remove: (id) => change(id, 0, 0),
    clear() {
      basket = emptyBasket();
      hidden = [];
      capped.clear();
      message = null;
      persistAndRender();
    },
    setBarHidden(h) {
      barHidden = h;
      renderBar();
    },
    sync(items, reserving, live) {
      active = reserving;
      document.body.classList.toggle("reserving", reserving);
      updaters.clear(); // rows are about to be rebuilt
      if (reserving) {
        if (live) {
          // The live list is the truth: restore the buyer's real counts, add the entries the cached render
          // hid, then lower to what is free now. Entries are added in order only while the total stays at
          // or under 15 (B2); any that do not fit are dropped with the limit message.
          const full = pruneBasket([...basket.map((e) => ({ id: e.id, units: capped.get(e.id) ?? e.units })), ...hidden], items);
          let next = emptyBasket();
          for (const e of full) {
            const r = setUnits(next, e.id, e.units, MAX_BASKET_UNITS);
            if (r.refused === "basket-limit") message = refusalText("basket-limit");
            else next = r.basket;
          }
          basket = next;
          hidden = [];
          capped.clear();
          writeStored(basket);
        } else {
          // Cached list: prune for display only. Lowered counts (B3) and whole entries it hides (F4) stay in
          // storage until live.
          const pruned = pruneBasket(basket, items);
          capped.clear();
          for (const e of basket) {
            const p = pruned.find((x) => x.id === e.id);
            if (p && p.units < e.units) capped.set(e.id, e.units);
          }
          hidden = basket.filter((e) => !pruned.some((p) => p.id === e.id));
          basket = pruned;
        }
      }
      renderBar();
    },
  };
}
