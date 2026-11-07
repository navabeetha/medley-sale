// The per-unit Back out button and its confirmation (S-14), shared by the booking page and the My reservations page
// (S-19) so both word it and behave the same. The page owns the data and the request; this owns only the button, the
// "Yes, back out" / "Cancel" box, the "Backing out…" wait and the error line. All text goes in via textContent.
import { el } from "./dom";

export interface BackOutUi {
  /** One unit: its Back out button, plus the confirmation when this is the claim being confirmed. */
  unit(token: string, claimId: number, name: string, label: string): HTMLElement;
  /** Call at the top of the page's render(): units are told apart by token, claim and how many times that pair came before. */
  startRender(): void;
  /** Forgets any open confirmation and error (the page changed what it shows). */
  reset(): void;
}

/**
 * `run(token, claimId)` makes the request and updates the page's own data. It answers true on success, false on a
 * refusal or failure, and null when the answer is stale (the buyer left): then nothing here changes. `render` redraws
 * the page; `onDone` runs after a success has been drawn.
 */
export function createBackOutUi(
  root: HTMLElement,
  render: () => void,
  run: (token: string, claimId: number) => Promise<boolean | null>,
  onDone: () => void,
): BackOutUi {
  let confirming: string | null = null; // the unit (token + claim) whose confirmation is open
  let backing = false; // a back-out is in flight
  let backError = false;
  let seen = new Map<string, number>(); // how often each token/claim pair was drawn in this render

  async function backOut(token: string, claimId: number): Promise<void> {
    if (backing) return;
    backing = true;
    backError = false;
    render();
    const ok = await run(token, claimId).catch(() => false);
    if (ok === null) return;
    backing = false;
    backError = !ok;
    if (ok) confirming = null;
    render();
    if (ok) onDone();
  }

  return {
    startRender() {
      seen = new Map();
    },
    reset() {
      confirming = null;
      backing = backError = false;
    },
    unit(token, claimId, name, label) {
      // The same claim twice in one answer should not happen, but then each copy still has its own confirmation.
      const pair = `${token}/${claimId}`, nth = seen.get(pair) ?? 0;
      seen.set(pair, nth + 1);
      const id = `${pair}#${nth}`;
      const u = el("div", undefined, "unit", "booking-unit");
      const open = el("button", "Back out", "backout", "backout-open");
      open.type = "button";
      open.dataset.claim = String(claimId);
      open.setAttribute("aria-label", `Back out ${name}${label}`);
      open.addEventListener("click", () => {
        if (backing) return;
        confirming = id;
        backError = false;
        render();
        root.querySelector<HTMLElement>('[data-testid="backout-cancel"]')?.focus();
      });
      u.append(open);
      if (confirming !== id) return u;
      const box = el("div", undefined, "confirm", "backout-confirm");
      box.append(el("p", `Back out of ${name}? If you change your mind, you'll rejoin at the end of the line.`));
      const yes = el("button", backing ? "Backing out…" : "Yes, back out", "backout", "backout-yes");
      yes.type = "button";
      yes.disabled = backing;
      yes.addEventListener("click", () => void backOut(token, claimId));
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
    },
  };
}
