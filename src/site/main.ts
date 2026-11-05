// Catalogue screen (S-06, D-034 browse-only). Fetches the catalogue, shows the last good list
// from localStorage straight away, and renders rows. All data goes in via textContent only.
import type { CatalogueItem } from "../api/catalogue";
import { API_URL } from "./config";
import {
  availabilityLabels, displayTitle, formatPrice, pickupLabel, reserveUrl, sortItems, subtitle,
} from "./view-model";

interface Catalogue { items: CatalogueItem[]; contactUrl: string | null }
interface Photo { thumb: string; alt: string }

const CACHE_KEY = "medley-sale:catalogue:v1";
const TIMEOUT_MS = 20_000; // D-033: warm misses reach 13 s; give up well after that
const WA_PREFIX = "https://wa.me/";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  if (testid) e.dataset.testid = testid;
  return e;
}

// ---- cache (localStorage may be blocked or corrupt: every access is guarded) ----

function parseCatalogue(v: unknown): Catalogue | null {
  const o = v as { items?: unknown; contactUrl?: unknown } | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.items) || "error" in o) return null;
  // Only a wa.me link is ever used as a contact URL, whatever the response says.
  const c = typeof o.contactUrl === "string" && o.contactUrl.startsWith(WA_PREFIX) ? o.contactUrl : null;
  return { items: o.items as CatalogueItem[], contactUrl: c };
}

function readCache(): Catalogue | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parseCatalogue(JSON.parse(raw)) : null;
  } catch {
    return null;
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

async function fetchManifest(): Promise<Record<string, Photo[]>> {
  try {
    const res = await fetch("photos/manifest.json");
    const m: unknown = res.ok ? await res.json() : {};
    return m && typeof m === "object" ? (m as Record<string, Photo[]>) : {};
  } catch {
    return {}; // no photos is fine; rows just have no thumbnail
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
  root.replaceChildren(
    el("h1", "A44 Medley Garage Sale"),
    el("p", "This is an early version. If anything looks odd, just message me.", "note", "early-note"),
    status, notes, list,
  );

  const manifest = fetchManifest();
  let contactUrl: string | null = null;
  let hasList = false;

  async function show(c: Catalogue): Promise<void> {
    const photos = await manifest;
    contactUrl = c.contactUrl ?? contactUrl;
    hasList = true;
    const items = sortItems(c.items);
    list.replaceChildren(...items.map((i) => row(i, c.contactUrl, photos[i.id]?.[0])));
    const lines: HTMLElement[] = [];
    if (items.length === 0) {
      lines.push(el("p", "Nothing is listed right now. Please check back soon."));
    } else {
      lines.push(el("p", "All prices negotiable.", "note"));
      if (items.some((i) => i.tab === "Books")) lines.push(el("p", "Books: Free for libraries and students.", "note"));
    }
    notes.replaceChildren(...lines);
  }

  function showLoading(): void {
    status.replaceChildren(el("p", "Loading the sale… this can take a few seconds", "note", "loading"));
  }

  function showError(): void {
    const box = el("div", undefined, "error", "catalogue-error");
    box.setAttribute("role", "alert");
    box.append(el("p", "We couldn't load the sale just now. Please try again."));
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
      writeCache(c);
      await show(c);
      status.replaceChildren();
    } catch {
      showError(); // a cached list, if any, stays on screen underneath
    }
  }

  const cached = readCache();
  if (cached) {
    contactUrl = cached.contactUrl;
    void show(cached).then(() => load());
  } else {
    void load();
  }
}

function row(item: CatalogueItem, contactUrl: string | null, photo: Photo | undefined): HTMLElement {
  const li = el("li", undefined, "row", "item-row");
  li.dataset.id = item.id;
  if (photo) {
    const img = el("img", undefined, "thumb");
    img.src = `photos/${photo.thumb}`;
    img.alt = photo.alt;
    img.width = 72;
    img.height = 72;
    img.loading = "lazy";
    li.append(img);
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
  const href = reserveUrl(contactUrl, item.name);
  if (href) {
    const a = el("a", "Message to reserve", "reserve");
    a.href = href;
    body.append(a);
  }
  li.append(body);
  return li;
}
