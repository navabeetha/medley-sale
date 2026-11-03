# D-016: GitHub repo name is `medley-sale`. Git is set up at G0

- **Status:** Proposed
- **Date:** 2026-11-03
- **Raised by:** PM, docs setup
- **Context:** The local folder is called `a44GarageSale`, but brief Section 11.1 names the repo `medley-sale/`. The local folder isn't a git repo yet.
- **Options:** (a) name the GitHub repo `medley-sale` as in the brief; (b) name it `a44GarageSale` to match the folder.
- **Decision:** (a). The seller creates the public GitHub repo as `medley-sale` at G0 stage 1. The local folder name doesn't matter to git or Pages and stays as it is. `git init` and the first push happen at G0 stage 1, once the GitHub repo exists. Agents don't set up a remote before then.
- **Why:** It follows the brief and keeps "A44" (the house number) out of the Pages URL path. D-012 accepts the house number in the site title, but leaving it out of the URL is the smaller exposure.
- **Consequences / revisit if:** The Pages URL will be `https://<github-username>.github.io/medley-sale/`. The `SITE_URL` Script Property and the site's base path assume this. If the seller picks another name, update both.
