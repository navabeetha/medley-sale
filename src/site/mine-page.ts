// S-19 "My reservations" page at #/mine: every booking saved on this device in one view. One `mine` request carries the
// saved tokens in a POST body; the answer's units each carry their own booking's token, which Back out sends. Sections:
// Reserved (held and waiting, with one "Send the details" message), Sold to you, Backed out (one "Tell the seller"
// message), then My details with Forget. Tokens never leave the hash of #/b/ and POST bodies. All text goes in via
// textContent; the server's own error text is never shown.
import { postJson } from "./api-post";
import { createBackOutUi } from "./backout-unit";
import { forgetBuyer, readBuyer } from "./buyer";
import { el } from "./dom";
import { forgetBooking, readSaved } from "./saved-bookings";

const TIMEOUT_MS = 30_000; // a cold Apps Script start takes ~13 s (D-033)
const MAX_TOKENS = 20; // the API's limit: ask about the 20 newest
const WA_PREFIX = "https://wa.me/";

interface Line { token: string; name: string; detail?: unknown; quantity: number; claimIds: number[] }
interface WaitingLine { token: string; claimId: number; name: string; position: number; itemSold: boolean }
interface Answer { reserved: Line[]; waiting: WaitingLine[]; sold: Line[]; backedOut: Line[]; whatsapp: string | null; tellUrl: string | null }
type Phase = "loading" | "ready" | "empty" | "error";

export interface MinePage {
  /** Shows the page. A call while it is already open does nothing. */
  open(): void;
  /** Takes the page out; the next open() asks the server again. */
  close(): void;
}

const waUrl = (v: unknown): string | null => (typeof v === "string" && v.startsWith(WA_PREFIX) ? v : null);
/** Only well-formed units: a unit without its booking's token could not be backed out, so it is not shown. */
const units = <T extends { token?: unknown }>(v: unknown): T[] =>
  (Array.isArray(v) ? (v as T[]).filter((l) => !!l && typeof l === "object" && typeof l.token === "string" && l.token !== "") : []);
const unitLabel = (n: number): string => (n > 1 ? ` × ${n}` : "");

/** `onChanged` runs after a back-out succeeded, so the sale list can be read again (a freed unit shows there). */
export function createMinePage(root: HTMLElement, onChanged: () => void): MinePage {
  let isOpen = false;
  let phase: Phase = "loading";
  let answer: Answer | null = null;
  let seq = 0; // a stale answer (the buyer left, or asked again) is ignored

  const back = el("a", "← Back to the sale", "back", "mine-back");
  back.href = "#/";

  /** Asks `mine` for the saved tokens. Answers the next phase and fills `answer`, or null when the answer is stale. */
  async function fetchMine(): Promise<Phase | null> {
    const mine = ++seq;
    const tokens = readSaved().slice(0, MAX_TOKENS);
    if (tokens.length === 0) { answer = null; return "empty"; }
    let next: Phase = "error";
    try {
      const r = (await postJson({ action: "mine", tokens }, TIMEOUT_MS)) as Record<string, unknown> | null;
      if (mine !== seq) return null;
      if (r?.ok === true) {
        // Only a definite notFound drops a token; a failed or refused request removes nothing.
        if (Array.isArray(r.notFound)) for (const t of r.notFound) if (typeof t === "string") forgetBooking(t);
        answer = {
          reserved: units<Line>(r.reserved), waiting: units<WaitingLine>(r.waiting), sold: units<Line>(r.sold),
          backedOut: units<Line>(r.backedOut), whatsapp: waUrl(r.whatsappUrl), tellUrl: waUrl(r.backedOutUrl),
        };
        const any = answer.reserved.length + answer.waiting.length + answer.sold.length + answer.backedOut.length > 0;
        next = any || readSaved().length > 0 ? "ready" : "empty";
      }
    } catch {
      if (mine !== seq) return null;
      /* network failure or timeout: a retryable error, never "no reservations" */
    }
    return next;
  }

  async function load(): Promise<void> {
    phase = "loading";
    render();
    const next = await fetchMine();
    if (next === null) return;
    phase = next;
    render();
  }

  // Back out with the unit's own token; on success ask `mine` again and show the new answer in the same redraw.
  async function backOutRequest(token: string, claimId: number): Promise<boolean | null> {
    const mine = seq;
    const r = (await postJson({ action: "backOut", token, claimId }, TIMEOUT_MS)) as { ok?: unknown } | null;
    if (mine !== seq) return null; // the buyer left the page meanwhile
    if (r?.ok !== true) return false;
    const next = await fetchMine().catch(() => "error" as Phase);
    if (next === null) return null;
    phase = next;
    return true;
  }
  const backUi = createBackOutUi(root, () => render(), backOutRequest, () => onChanged()); // a back-out frees a unit

  function group(name: string, heading: string, lines: HTMLElement[]): HTMLElement | null {
    if (lines.length === 0) return null;
    const sec = el("section", undefined, "group", `mine-group-${name}`);
    const ul = el("ul", undefined, "lines");
    ul.setAttribute("role", "list");
    for (const l of lines) ul.append(l);
    sec.append(el("h2", heading), ul);
    return sec;
  }

  function plainLine(l: Line): HTMLElement {
    const li = el("li", undefined, "line", "mine-line");
    li.append(el("p", `${l.name}${unitLabel(l.quantity)}`, "name"));
    if (typeof l.detail === "string" && l.detail) li.append(el("p", l.detail, "sub"));
    return li;
  }

  function reservedLine(l: Line): HTMLElement {
    const li = plainLine(l);
    const ids = Array.isArray(l.claimIds) ? l.claimIds : [];
    ids.forEach((id, i) => li.append(backUi.unit(l.token, id, l.name, ids.length > 1 ? ` (${i + 1} of ${ids.length})` : "")));
    return li;
  }

  function waitingLine(w: WaitingLine): HTMLElement {
    const li = el("li", undefined, "line", "mine-line");
    li.append(el("p", w.name, "name"), el("p", `Waiting list position ${w.position}.`, "status"));
    if (w.itemSold) li.append(el("p", "This item was sold. You stay in line in case it comes back.", "sub"));
    li.append(backUi.unit(w.token, w.claimId, w.name, ""));
    return li;
  }

  // A wa.me link that opens in a new tab; never opened for the buyer.
  function offer(text: string, href: string, testid: string): HTMLElement {
    const a = el("a", text, "wa", testid);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  // The remembered name and number, with the one button that clears them (and nothing else).
  function details(): HTMLElement | null {
    const buyer = readBuyer();
    if (!buyer) return null;
    const sec = el("section", undefined, "group", "mine-details");
    const forget = el("button", "Forget my details", "forget", "mine-forget");
    forget.type = "button";
    forget.addEventListener("click", () => {
      forgetBuyer(); // only the buyer key: the saved bookings and the reservations on screen stay
      render();
      root.querySelector<HTMLElement>("h1")?.focus();
    });
    sec.append(
      el("h2", "My details"),
      el("p", buyer.name, "name", "mine-details-name"),
      el("p", buyer.number, "sub", "mine-details-number"),
      forget,
    );
    return sec;
  }

  function render(): void {
    backUi.startRender();
    const parts: (HTMLElement | null)[] = [back];
    const heading = el("h1", "My reservations");
    heading.tabIndex = -1; // focus lands here after Forget removes the button
    if (phase === "loading") {
      parts.push(heading, el("p", "Loading your reservations… this can take a few seconds", "note", "mine-loading"));
    } else if (phase === "error") {
      const box = el("div", undefined, "error", "mine-error");
      box.setAttribute("role", "alert");
      box.append(el("p", "We couldn't load your reservations just now. Please try again."));
      const retry = el("button", "Try again", undefined, "mine-retry");
      retry.type = "button";
      retry.addEventListener("click", () => void load());
      box.append(retry);
      parts.push(heading, box);
    } else if (phase === "empty" || !answer) {
      parts.push(heading, el("p", "You have no saved reservations on this device.", "note", "mine-empty"), details());
    } else {
      const a = answer;
      const reserved = group("reserved", "Reserved", [...a.reserved.map(reservedLine), ...a.waiting.map(waitingLine)]);
      if (reserved && a.whatsapp) reserved.append(offer("Send the details to the seller on WhatsApp", a.whatsapp, "mine-whatsapp"));
      const out = group("backedout", "Backed out", a.backedOut.map(plainLine));
      if (out && a.tellUrl) out.append(offer("Tell the seller you backed out", a.tellUrl, "mine-tell-seller"));
      parts.push(heading, reserved, group("sold", "Sold to you", a.sold.map(plainLine)), out, details());
    }
    root.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }

  return {
    open() {
      if (isOpen) return;
      isOpen = true;
      answer = null;
      backUi.reset();
      void load();
    },
    close() {
      isOpen = false;
      seq++;
      root.replaceChildren();
    },
  };
}
