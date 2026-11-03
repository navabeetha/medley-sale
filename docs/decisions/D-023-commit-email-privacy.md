# D-023: Commits use a GitHub no-reply email

- **Status:** Proposed. **The seller confirms at G0.1** (it's about her own account and personal details).
- **Date:** 2026-11-03
- **Raised by:** PM, docs setup
- **Context:** Every git commit records an author name and email, and in a public repo anyone can read them. The brief's hard rules cover numbers, names and sheet data, but not the owner's email address. A personal email in the public history is hard to remove later.
- **Options:** (a) use GitHub's no-reply address (`<id>+<username>@users.noreply.github.com`) and the GitHub username as the author name for this repo; (b) use her normal email.
- **Decision (proposed):** (a). It's set once at G0.1, for this repo only. Agents' commits use the same identity, with the `Co-Authored-By` trailer for the agent.
- **Why:** It's the smaller exposure and is easy to set up before the first commit. Changing it after the first push means rewriting history.
- **Consequences:** No personal email in the public history.
