// Placeholder entry (S-01). Real views and routing arrive with S-06 onwards.
const app = document.getElementById("app");
if (app) {
  const h1 = document.createElement("h1");
  h1.textContent = "A44 Medley Garage Sale";
  const p = document.createElement("p");
  p.textContent = "Coming soon.";
  app.replaceChildren(h1, p);
}
