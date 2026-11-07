// The name and number a buyer chose to remember on this device (brief 6.3), in localStorage. Shared by the reserve
// screen (prefill, remember) and the My reservations page (show, forget). Every access is guarded: storage may be
// blocked or corrupt (T-14). Forgetting removes this key only, never the saved bookings list.
const BUYER_KEY = "medley-sale:buyer:v1";

export function readBuyer(): { name: string; number: string } | null {
  try {
    const o = JSON.parse(localStorage.getItem(BUYER_KEY) ?? "null") as { name?: unknown; number?: unknown } | null;
    return o && typeof o.name === "string" && typeof o.number === "string" ? { name: o.name, number: o.number } : null;
  } catch {
    return null;
  }
}

export function writeBuyer(name: string, number: string): void {
  try {
    localStorage.setItem(BUYER_KEY, JSON.stringify({ name, number }));
  } catch {
    /* blocked or full: nothing is remembered */
  }
}

export function forgetBuyer(): void {
  try {
    localStorage.removeItem(BUYER_KEY);
  } catch {
    /* blocked: nothing to clear */
  }
}
