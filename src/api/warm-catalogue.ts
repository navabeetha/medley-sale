// R1 / D-034 rule 1: the time-driven warm job. Rebuilds the catalogue and
// replaces the cached body, so a visitor almost always gets a cache hit. Run
// every 5 minutes by a trigger the seller installs by hand. Never throws, and
// never caches an error body: on failure the previous good body stays until it
// expires. Logs carry no exception text, which could contain cell content.
import { CATALOGUE_CACHE_KEY, CATALOGUE_CACHE_SECONDS, type GetCache } from "./handle-get";

export interface WarmDeps {
  catalogue: () => unknown;
  cache: GetCache;
  log?: (line: string) => void;
}

/** True when a fresh body was cached; false when the build or the cache write failed. */
export function warmCatalogue(deps: WarmDeps): boolean {
  // A throwing log sink must not turn a handled failure into a thrown one.
  const log = (line: string): void => {
    try {
      deps.log?.(line);
    } catch {
      /* nothing useful left to do */
    }
  };
  let body: string;
  try {
    body = JSON.stringify(deps.catalogue());
  } catch {
    log("warmCatalogue: building the catalogue failed; the cache was left as it was");
    return false;
  }
  try {
    deps.cache.put(CATALOGUE_CACHE_KEY, body, CATALOGUE_CACHE_SECONDS);
  } catch {
    log("warmCatalogue: writing the cache failed");
    return false;
  }
  log("warmCatalogue: cache refreshed");
  return true;
}
