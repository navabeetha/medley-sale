// S-04: GET request handling (brief 4.3, D-030 rules 7 and 8). Pure: the Apps
// Script entry point passes in the catalogue builder and the cache. Every
// answer is a JSON string and this function never throws.

/** Cache key for the catalogue body. Write handlers (S-11, S-14, S-15) remove it. */
export const CATALOGUE_CACHE_KEY = "catalogue";
/**
 * 10 minutes: twice the 5-minute warm interval (D-034), so a late warm run
 * still leaves a hit. Writes clear the key; until S-15's on-edit trigger, sheet
 * edits by hand show within the warm interval.
 */
export const CATALOGUE_CACHE_SECONDS = 600;

export interface GetCache {
  get(key: string): string | null;
  put(key: string, value: string, seconds: number): void;
}

export interface GetDeps {
  catalogue: () => unknown;
  cache?: GetCache;
}

export function handleGet(params: Record<string, string | undefined>, deps: GetDeps): string {
  // Exactly "catalogue": no trimming, no case folding, and the action is never echoed back.
  if (params.action !== "catalogue") return JSON.stringify({ error: "unknown action" });
  try {
    // A broken cache must not take the catalogue down, so cache failures are ignored.
    try {
      const hit = deps.cache?.get(CATALOGUE_CACHE_KEY);
      if (hit) return hit;
    } catch {
      /* fall through to a fresh build */
    }
    const body = JSON.stringify(deps.catalogue());
    try {
      deps.cache?.put(CATALOGUE_CACHE_KEY, body, CATALOGUE_CACHE_SECONDS);
    } catch {
      /* an uncached answer is still a good answer */
    }
    return body;
  } catch {
    // Generic on purpose: an exception message could contain cell content (D-030 rule 8).
    return JSON.stringify({ error: "unavailable" });
  }
}
