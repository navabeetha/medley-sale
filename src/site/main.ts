// Catalogue screen (S-06, D-034 browse-only). Fetches the catalogue, shows the last good list
// from localStorage straight away, and renders rows. All data goes in via textContent only.
import type { CatalogueItem } from "../api/catalogue";
import { createBasketView } from "./basket-view";
import { API_URL } from "./config";
import { el } from "./dom";
import { createReserveScreen } from "./reserve-screen";
import {
  availabilityLabels, displayTitle, formatPrice, pickupLabel, reserveUrl, sortItems, subtitle, validItems,
} from "./view-model";

// `reserving` is D-038 rule 6: true only when the response says exactly `true`; the cache keeps it.
interface Catalogue { items: CatalogueItem[]; contactUrl: string | null; reserving: boolean }
interface Photo { thumb: string; alt: string }

const CACHE_KEY = "medley-sale:catalogue:v1";
const MANIFEST_KEY = "medley-sale:manifest:v1";
const TIMEOUT_MS = 20_000; // D-033: warm misses reach 13 s; give up well after that
const WA_PREFIX = "https://wa.me/";

// ---- cache (localStorage may be blocked or corrupt: every access is guarded) ----

function parseCatalogue(v: unknown): Catalogue | null {
  const o = v as { items?: unknown; contactUrl?: unknown; reserving?: unknown } | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.items) || "error" in o) return null;
  // Only a wa.me link is ever used as a contact URL, whatever the response says.
  const c = typeof o.contactUrl === "string" && o.contactUrl.startsWith(WA_PREFIX) ? o.contactUrl : null;
  return { items: validItems(o.items), contactUrl: c, reserving: o.reserving === true };
}

function readCache(): Catalogue | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const c = parseCatalogue(parsed);
    // We wrote this cache ourselves, so one bad item means it is corrupt: treat the whole thing
    // as no cache (and drop it) rather than show a partial list. Zero valid items is no cache too.
    const n = (parsed as { items: unknown[] }).items.length;
    if (c && c.items.length > 0 && c.items.length === n) return c;
    clearCache();
    return null;
  } catch {
    return null;
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* blocked: nothing to clear */
  }
}

function writeCache(c: Catalogue): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* blocked or full: the site works without a cache */
  }
}

// ---- network ----

async function fetchCatalogue(): Promise<Catalogue> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}?action=catalogue`, { signal: ctl.signal });
    if (!res.ok) throw new Error("http");
    const c = parseCatalogue(await res.json());
    if (!c) throw new Error("shape");
    return c;
  } finally {
    clearTimeout(timer);
  }
}

type Manifest = Record<string, unknown>;

/** The first well-formed photo of an item; malformed manifest entries are skipped (F5). */
function firstPhoto(m: Manifest, id: string): Photo | undefined {
  const list = m[id];
  if (!Array.isArray(list)) return undefined;
  return list.find((p): p is Photo =>
    !!p && typeof p === "object" && typeof (p as Photo).thumb === "string" && typeof (p as Photo).alt === "string");
}

function readManifestCache(): Manifest {
  try {
    const m: unknown = JSON.parse(localStorage.getItem(MANIFEST_KEY) ?? "null");
    return m && typeof m === "object" && !Array.isArray(m) ? (m as Manifest) : {};
  } catch {
    return {};
  }
}

/** No timeout (F8): the list never waits on photos, so a slow manifest just fills in late. Null on failure. */
async function fetchManifest(): Promise<Manifest | null> {
  try {
    const res = await fetch("photos/manifest.json");
    const m: unknown = res.ok ? await res.json() : null;
    if (!m || typeof m !== "object" || Array.isArray(m)) return null;
    try {
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
    } catch {
      /* blocked or full: no manifest cache */
    }
    return m as Manifest;
  } catch {
    return null;
  }
}

// ---- view ----

const app = document.getElementById("app");
if (app) start(app);

function start(root: HTMLElement): void {
  const status = el("div"); // loading line or error notice
  const notes = el("div");
  const list = el("ul", undefined, "catalogue", "catalogue");
  list.setAttribute("role", "list");
  // Two screens in one page (S-10): the catalogue, and the reservation form at #/reserve.
  const catalogueView = el("div");
  catalogueView.append(
    el("h1", "A44 Medley Garage Sale"),
    el("p", "This is an early version. If anything looks odd, just message me.", "note", "early-note"),
    status, notes, list,
  );
  const reserveView = el("div");
  root.replaceChildren(catalogueView, reserveView);

  const basket = createBasketView();
  const reserve = createReserveScreen(reserveView, basket, (token) => {
    location.hash = `#/b/${encodeURIComponent(token)}`; // S-12 builds that page; the token is only ever in the hash
  });
  let reserving = false;
  let photos: Manifest = readManifestCache(); // last good manifest: repeat visits show thumbnails at once
  let contactUrl: string | null = null;
  let hasList = false;
  let manifestSettled = false; // empty photo slots are removed only once the manifest has arrived or failed

  // Puts a thumbnail in (or takes an empty slot out of) every row, using the current manifest.
  function applyPhotos(): void {
    for (const li of list.children) {
      const id = (li as HTMLElement).dataset.id;
      const photo = id ? firstPhoto(photos, id) : undefined;
      const slot = li.querySelector(".slot");
      if (photo && slot) fillSlot(slot as HTMLElement, photo);
      else if (photo) {
        const s = el("span", undefined, "slot");
        fillSlot(s, photo);
        li.prepend(s);
      } else if (slot && !slot.firstChild && manifestSettled) slot.remove();
    }
  }

  // The reservation screen replaces the catalogue only in reserving mode (D-038 rule 6); otherwise #/reserve
  // is just the normal R1 list. Anything else in the hash (#/, #/b/<token>) shows the catalogue.
  function route(): void {
    const onReserve = reserving && location.hash === "#/reserve";
    const wasOnReserve = reserveView.firstChild !== null;
    catalogueView.hidden = onReserve;
    basket.setBarHidden(onReserve);
    if (onReserve) {
      reserve.open();
      if (!wasOnReserve) window.scrollTo(0, 0);
    } else {
      reserve.close();
    }
  }
  window.addEventListener("hashchange", route);

  function show(c: Catalogue, live: boolean): void {
    contactUrl = c.contactUrl ?? contactUrl;
    hasList = true;
    reserving = c.reserving;
    const items = sortItems(c.items);
    basket.sync(c.items, c.reserving, live); // before the rows, which ask it for their controls
    // The live list rebuilds every row, which would drop keyboard focus to <body> (QA S-09 F3):
    // remember the focused control by row id + testid and put focus back afterwards.
    const was = document.activeElement as HTMLElement | null;
    const wasRow = was && list.contains(was) ? (was.closest("[data-id]") as HTMLElement | null)?.dataset.id : undefined;
    const wasTestId = was?.dataset.testid;
    list.replaceChildren(...items.map((i) => row(i, c.contactUrl, firstPhoto(photos, i.id), basket.control(i))));
    const lines: HTMLElement[] = [];
    if (items.length === 0) {
      lines.push(el("p", "Nothing is listed right now. Please check back soon."));
    } else {
      lines.push(el("p", "All prices negotiable.", "note"));
      if (items.some((i) => i.tab === "Books")) lines.push(el("p", "Books: Free for libraries and students.", "note"));
    }
    notes.replaceChildren(...lines);
    if (wasRow) restoreFocus(wasRow, wasTestId);
    if (manifestSettled) applyPhotos();
    reserve.update(c.items);
    route();
  }

  function restoreFocus(rowId: string, testId: string | undefined): void {
    const li = [...list.children].find((r) => (r as HTMLElement).dataset.id === rowId);
    if (!li) return;
    const same = testId ? li.querySelector<HTMLElement>(`[data-testid="${testId}"]`) : null;
    // A control that is now disabled (e.g. "-" at zero) cannot take focus: use the row's first enabled one.
    const target = same && !(same as HTMLButtonElement).disabled ? same : li.querySelector<HTMLElement>("button:not(:disabled)");
    target?.focus();
  }

  function showLoading(): void {
    status.replaceChildren(el("p", "Loading the sale… this can take a few seconds", "note", "loading"));
  }

  function showError(): void {
    const box = el("div", undefined, "error", "catalogue-error");
    box.setAttribute("role", "alert");
    box.append(el("p", hasList
      ? "Couldn't refresh just now — showing the last saved list."
      : "We couldn't load the sale just now. Please try again."));
    const retry = el("button", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => void load());
    box.append(retry);
    // The fallback link exists only if a good response (live or cached) told us the contact URL.
    if (contactUrl) {
      const a = el("a", "Or message me on WhatsApp");
      a.href = contactUrl;
      const p = el("p");
      p.append(a);
      box.append(p);
    }
    status.replaceChildren(box);
  }

  async function load(): Promise<void> {
    if (!hasList) showLoading();
    else status.replaceChildren();
    try {
      const c = await fetchCatalogue();
      show(c, true);
      writeCache(c);
      status.replaceChildren();
    } catch {
      showError(); // a cached list, if any, stays on screen underneath
    }
  }

  // Thumbnails arrive whenever the manifest does; the list never waits for it.
  void fetchManifest().then((m) => {
    if (m) photos = m;
    manifestSettled = true;
    applyPhotos();
  });

  const cached = readCache();
  if (cached) {
    try {
      show(cached, false);
    } catch {
      // A cached list that cannot be drawn must not leave a blank page: drop it and load normally.
      clearCache();
      hasList = false;
      list.replaceChildren();
      notes.replaceChildren();
    }
  }
  void load();
}

function fillSlot(slot: HTMLElement, photo: Photo): void {
  const img = el("img", undefined, "thumb");
  img.src = `photos/${photo.thumb}`;
  img.alt = photo.alt;
  img.width = 72;
  img.height = 72;
  img.loading = "lazy";
  slot.replaceChildren(img);
}

function row(item: CatalogueItem, contactUrl: string | null, photo: Photo | undefined, control: HTMLElement | null): HTMLElement {
  const li = el("li", undefined, "row", "item-row");
  li.dataset.id = item.id;
  // The 72 px slot is reserved when a photo is known or expected, so a late manifest causes no shift.
  if (photo || item.photos > 0) {
    const slot = el("span", undefined, "slot");
    if (photo) fillSlot(slot, photo);
    li.append(slot);
  }
  const body = el("div", undefined, "body");
  body.append(el("p", displayTitle(item), "name", "item-name"));
  const sub = subtitle(item);
  if (sub) body.append(el("p", sub, "sub", "item-sub"));
  const meta = el("p", undefined, "meta");
  meta.append(el("span", formatPrice(item.price), "price", "item-price"), el("span", pickupLabel(item.availableFrom), undefined, "item-pickup"));
  body.append(meta);
  const labels = availabilityLabels(item);
  if (labels.length) body.append(el("p", labels.join(" · "), "status", "item-status"));
  // Reserving mode (S-09) swaps the per-card WhatsApp link for the basket control.
  const href = control ? null : reserveUrl(contactUrl, item.name);
  if (control) body.append(control);
  if (href) {
    const a = el("a", "Message to reserve", "reserve");
    a.href = href;
    body.append(a);
  }
  li.append(body);
  return li;
}
