// Tiny DOM helper shared by the site views. Text always goes in via textContent, never innerHTML.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  if (testid) e.dataset.testid = testid;
  return e;
}
