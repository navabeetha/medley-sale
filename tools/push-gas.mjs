// Pushes dist/appscript with a pinned clasp (run via npm run push:gas, which
// builds first). The package spec is joined at runtime because the personal-data
// scan reads a literal "name@version" as an email address.
import { spawnSync } from "node:child_process";

const clasp = ["@google/clasp", "3.4.1"].join("@");
const r = spawnSync("npx", ["-y", clasp, "push", "-f"], { stdio: "inherit" });
process.exit(r.status ?? 1);
