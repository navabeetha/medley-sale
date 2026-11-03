# D-024: Owner's name kept out of the public repo

- **Status:** Accepted (the seller, 2026-11-03)
- **Context:** The brief named the owner by first name and is committed to a public repo (11.1).
- **Decision:** Replace the owner's first name with "the seller" in the brief and all docs, including unpublished history, before the first push. The brief's meaning is unchanged. The word is blocked by the PII scan from a list kept outside the repo (`private/blocked-words.txt` locally, `PII_BLOCKED_WORDS` secret in CI), never in committed files.
- **Rejected:** storing the blocked word as a hash in the repo, because a short first name is easy to recover from a hash.
