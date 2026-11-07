// S-12 booking page at #/b/<token> and S-14 back-out on it (brief 2.7, 4.3, 6.1, 6.4). Asks the server for the
// booking, shows it in its four groups, offers the WhatsApp link and a per-unit Back out. The token is only in the
// hash and in POST bodies. All text goes in via textContent; the server's own error text is never shown.
import { postJson } from "./api-post";
import { el } from "./dom";
import { forgetBooking } from "./saved-bookings";

const BOOKING_KEY = "medley-sale:last-booking:v1"; // sessionStorage: the reserve answer, written by reserve-screen
const TIMEOUT_MS = 30_000; // a cold Apps Script start takes ~13 s (D-033)
const WA_PREFIX = "https://wa.me/";
const SAVED = "Your reservation is saved, even if you don't send the message."; // brief 6.4

interface Line { name: string; detail?: unknown; quantity: number; claimIds: number[] }
interface WaitingLine { claimId: number; name: string; position: number; itemSold: boolean }
interface View { reserved: Line[]; waiting: WaitingLine[]; sold: Line[]; ended: Line[] }
interface Skipped { name: string; why: string }
type Phase = "loading" | "ready" | "notfound" | "error";

export interface BookingPage {
  /** Shows the page for a token. A call for the token already shown does nothing. */
  open(token: string): void;
  /** Takes the page out; the next open() asks the server again. */
  close(): void;
}

const waUrl = (v: unknown): string | null => (typeof v === "string" && v.startsWith(WA_PREFIX) ? v : null);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The skipped items of THIS booking's reserve answer (S-10 keeps it in sessionStorage), or none. */
function readSkipped(token: string): Skipped[] {
  try {
    const o = JSON.parse(sessionStorage.getItem(BOOKING_KEY) ?? "null") as { token?: unknown; skipped?: unknown } | null;
    if (!o || o.token !== token) return [];
    return list<{ name?: unknown; reason?: unknown }>(o.skipped).map((s) => ({
      name: typeof s?.name === "string" && s.name.trim() ? s.name : "An item",
      why: s?.reason === "sold-out" ? "sold out" : "no longer available",
    }));
  } catch {
    return [];
  }
}

const unitLabel = (n: number): string => (n > 1 ? ` × ${n}` : "");

/** `onChanged` runs after a back-out succeeded, so the sale list can be read again (a freed unit shows there). */
export function createBookingPage(root: HTMLElement, onChanged: () => void): BookingPage {
  let token: string | null = null;
  let phase: Phase = "loading";
  let view: View | null = null;
  let whatsapp: string | null = null;
  let skipped: Skipped[] = [];
  let waSent = false; // waOpened goes out at most once per page view
  let seq = 0; // a stale answer (the buyer left, or asked again) is ignored
  let confirming: number | null = null; // the claim whose confirmation is open
  let backing = false; // a back-out is in flight
  let backError = false;
  let tellUrl: string | null = null;

  const back = el("a", "← Back to the sale", "back", "booking-back");
  back.href = "#/";

  async function load(): Promise<void> {
    const mine = ++seq;
    phase = "loading";
    render();
    let next: Phase = "error";
    try {
      const r = (await postJson({ action: "booking", token }, TIMEOUT_MS)) as { ok?: unknown; error?: unknown; booking?: View; whatsappUrl?: unknown; backedOutUrl?: unknown } | null;
      if (r?.ok === true && r.booking && typeof r.booking === "object") {
        view = r.booking;
        whatsapp = waUrl(r.whatsappUrl);
        tellUrl = waUrl(r.backedOutUrl);
        next = "ready";
      } else if (r?.ok === false && r.error === "not-found") {
        next = "notfound";
        if (token) forgetBooking(token); // only a definite not-found; errors and busy may still succeed later
      }
    } catch {
      /* network failure or timeout: a retryable error, never "not found" */
    }
    if (mine !== seq) return;
    phase = next;
    render();
  }

  function group(name: string, heading: string, lines: HTMLElement[]): HTMLElement | null {
    if (lines.length === 0) return null;
    const sec = el("section", undefined, "group", `booking-group-${name}`);
    const ul = el("ul", undefined, "lines");
    ul.setAttribute("role", "list");
    for (const l of lines) ul.append(l);
    sec.append(el("h2", heading), ul);
    return sec;
  }

  function plainLine(l: Line): HTMLElement {
    const li = el("li", undefined, "line", "booking-line");
    li.append(el("p", `${l.name}${unitLabel(l.quantity)}`, "name"));
    if (typeof l.detail === "string" && l.detail) li.append(el("p", l.detail, "sub"));
    return li;
  }

  // One unit: its Back out button, and its confirmation when that is the claim being confirmed.
  function unit(claimId: number, name: string, label: string): HTMLElement {
    const u = el("div", undefined, "unit", "booking-unit");
    const open = el("button", "Back out", "backout", "backout-open");
    open.type = "button";
    open.dataset.claim = String(claimId);
    open.setAttribute("aria-label", `Back out ${name}${label}`);
    open.addEventListener("click", () => {
      if (backing) return;
      confirming = claimId;
      backError = false;
      render();
      root.querySelector<HTMLElement>('[data-testid="backout-cancel"]')?.focus();
    });
    u.append(open);
    if (confirming !== claimId) return u;
    const box = el("div", undefined, "confirm", "backout-confirm");
    box.append(el("p", `Back out of ${name}? If you change your mind, you'll rejoin at the end of the line.`));
    const yes = el("button", backing ? "Backing out…" : "Yes, back out", "backout", "backout-yes");
    yes.type = "button";
    yes.disabled = backing;
    yes.addEventListener("click", () => void backOut(claimId));
    const cancel = el("button", "Cancel", "backout", "backout-cancel");
    cancel.type = "button";
    cancel.disabled = backing; // a request in flight cannot be closed
    cancel.addEventListener("click", () => {
      confirming = null;
      backError = false;
      render();
      root.querySelector<HTMLElement>(`[data-claim="${claimId}"]`)?.focus();
    });
    box.append(yes, cancel);
    if (backing) {
      const status = el("p", "Backing out… please wait", "note", "backout-status");
      status.setAttribute("role", "status"); // announced to screen readers
      box.append(status);
    }
    if (backError) {
      const err = el("p", "Couldn't back out just now. Please try again in a moment.", "field-error", "backout-error");
      err.setAttribute("role", "alert");
      box.append(err);
    }
    u.append(box);
    return u;
  }

  async function backOut(claimId: number): Promise<void> {
    if (backing) return;
    backing = true;
    backError = false;
    render();
    const mine = seq;
    let ok = false;
    try {
      const r = (await postJson({ action: "backOut", token, claimId }, TIMEOUT_MS)) as
        { ok?: unknown; booking?: View; whatsappUrl?: unknown; backedOutUrl?: unknown } | null;
      if (mine !== seq) return; // the buyer left the page meanwhile
      if (r?.ok === true && r.booking && typeof r.booking === "object") {
        view = r.booking;
        whatsapp = waUrl(r.whatsappUrl);
        tellUrl = waUrl(r.backedOutUrl);
        confirming = null;
        ok = true;
      }
    } catch {
      if (mine !== seq) return;
    }
    backing = false;
    backError = !ok;
    render();
    if (ok) onChanged();
  }

  function reservedLine(l: Line): HTMLElement {
    const li = plainLine(l);
    l.claimIds.forEach((id, i) => li.append(unit(id, l.name, l.claimIds.length > 1 ? ` (${i + 1} of ${l.claimIds.length})` : "")));
    return li;
  }

  function waitingLine(w: WaitingLine): HTMLElement {
    const li = el("li", undefined, "line", "booking-line");
    li.append(el("p", w.name, "name"), el("p", `Waiting list position ${w.position}.`, "status"));
    if (w.itemSold) li.append(el("p", "This item was sold. You stay in line in case it comes back.", "sub"));
    li.append(unit(w.claimId, w.name, ""));
    return li;
  }

  // A wa.me link that opens in a new tab; never opened for the buyer.
  function offer(text: string, href: string, testid: string, onTap?: () => void): HTMLElement {
    const a = el("a", text, "wa", testid);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (onTap) a.addEventListener("click", onTap);
    return a;
  }

  function render(): void {
    const parts: (HTMLElement | null)[] = [back];
    if (phase === "loading") {
      parts.push(el("p", "Loading your reservation… this can take a few seconds", "note", "booking-loading"));
    } else if (phase === "notfound") {
      parts.push(el("p", "We couldn't find that reservation. Please check the link, or message me.", "note", "booking-notfound"));
    } else if (phase === "error") {
      const box = el("div", undefined, "error", "booking-error");
      box.setAttribute("role", "alert");
      box.append(el("p", "We couldn't load your reservation just now. Please try again."));
      const retry = el("button", "Try again", undefined, "booking-retry");
      retry.type = "button";
      retry.addEventListener("click", () => void load());
      box.append(retry);
      parts.push(box);
    } else if (view) {
      parts.push(el("h1", "Your reservation"), el("p", SAVED, "note", "booking-saved"));
      if (skipped.length) {
        const box = el("div", undefined, "skipped-box", "booking-skipped");
        box.append(el("p", "Not reserved:"));
        const ul = el("ul", undefined, "skipped");
        for (const s of skipped) ul.append(el("li", `${s.name}: ${s.why}.`, undefined, "booking-skipped-item"));
        box.append(ul);
        parts.push(box);
      }
      parts.push(
        group("reserved", "Reserved", list<Line>(view.reserved).map(reservedLine)),
        group("waiting", "Waiting", list<WaitingLine>(view.waiting).map(waitingLine)),
      );
      if (whatsapp) parts.push(offer("Send the details to the seller on WhatsApp", whatsapp, "booking-whatsapp", tappedWhatsapp));
      const ended = group("ended", "Ended", list<Line>(view.ended).map(plainLine));
      // The backed-out note belongs to the Ended group, after its units.
      if (ended && tellUrl) ended.append(offer("Tell the seller you backed out", tellUrl, "tell-seller"));
      parts.push(group("sold", "Sold to you", list<Line>(view.sold).map(plainLine)), ended);
    }
    root.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }

  // The link opens by itself; this only tells the server, without waiting and ignoring any failure (brief 4.3).
  function tappedWhatsapp(): void {
    if (waSent) return;
    waSent = true;
    postJson({ action: "waOpened", token }, TIMEOUT_MS).catch(() => undefined);
  }

  return {
    open(t) {
      if (token === t) return;
      token = t;
      view = whatsapp = tellUrl = null;
      confirming = null;
      backing = backError = waSent = false;
      skipped = readSkipped(t);
      if (t === "") { // "#/b/" names no booking: no request
        seq++;
        phase = "notfound";
        render();
      } else {
        void load();
      }
    },
    close() {
      token = null;
      seq++;
      root.replaceChildren();
    },
  };
}
