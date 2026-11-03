# Runbook: human gates and cutover

This file covers what the seller does at each human gate (brief 10.2). The PM walks her through each step **in chat, one at a time**, in the brief's Section 11.7 format: what I need, why, time and cost, steps, you'll know it worked when, and if something looks wrong. This file is the checklist. The chat walkthrough gives the exact screens, which the PM checks against the current product at the time, because menus change.

> **Public repo.** Never write links, sheet IDs, script IDs, phone numbers or names in this file. Where a value is needed, it goes in a gitignored local file or in Script Properties, as noted below.
> Never paste a password or token into chat. Sign-ins happen in your own browser or Terminal window.

Gate G0 is done in three stages ([D-018](decisions/D-018-g0-in-stages.md)).

---

## G0: Setup (before S-01 deploys and S-03 runs)

### G0.1: Public GitHub repo. Blocks the S-01 Pages deploy

| # | Who | Step | Done |
|---|---|---|---|
| 1 | The seller | Confirm the commit identity: the GitHub no-reply email and username ([D-023](decisions/D-023-commit-email-privacy.md)) | ☐ |
| 2 | The seller | Create a **public** GitHub repo named `medley-sale` ([D-016](decisions/D-016-repo-name-medley-sale.md)), with no template files | ☐ |
| 3 | The seller | In the repo's Settings, under Pages, set the source to **GitHub Actions** | ☐ |
| 4 | The seller | Sign this computer in to GitHub herself, in her own browser or Terminal, so agents can push. No token goes in chat | ☐ |
| 5 | Agent | `git init`, set the agreed identity, first commit of the docs, push to `main` | ☐ |

Exit: the repo exists and is public, Pages source is Actions, and `main` holds the docs.

### G0.2: Build copy, script and clasp. Blocks S-03 running on the build copy

| # | Who | Step | Done |
|---|---|---|---|
| 1 | The seller | Make a **copy** of the sale sheet (making a copy doesn't change the real sheet). Include **`BUILD COPY`** in its title, because the scrub refuses to run otherwise | ☑ 2026-11-03 |
| 2 | The seller | Make sure the build copy is **not** shared publicly or with the group | ☑ 2026-11-03 |
| 3 | The seller | From the build copy, open Extensions, then Apps Script, to attach a script project | ☑ 2026-11-03 |
| 4 | The seller | Turn on the Apps Script API in her Apps Script user settings (needed for clasp to push code) | ☑ 2026-11-03 |
| 5 | The seller | Run `clasp login` herself in Terminal and complete the Google sign-in in her browser. Credentials stay in her home folder, never in the repo or chat | ☑ 2026-11-03 |
| 6 | The seller + PM | Give the PM the build copy's script ID **only when asked**. It goes in `.clasp.json`, which is gitignored. Never commit it | ☑ 2026-11-03 |

Exit: an agent can push code to the build copy's script. Nobody has read the build copy's data yet.

**Met 2026-11-03.** Existing build copy reused (title contains BUILD COPY; Share checked: owner only, Restricted). clasp (package `@google/clasp`, version 3.4.1) run via npx (not yet a dev dependency; S-03 decides). `.clasp.json` (gitignored) has `rootDir: dist/appscript`; an empty-project pull from a scratch folder confirmed access.

### G0.3: Scrub check. Blocks all other use of the build copy

| # | Who | Step | Done |
|---|---|---|---|
| 1 | Agent | Push the script and run **only** `scrubStaging()` (S-03). Don't read or print the copy's data | ☐ |
| 2 | The seller | Check by eye: every `Person` value is a synthetic name, the seller's number is gone from the README tab and every tab header, and no comments are left (she deletes any the script couldn't remove) | ☐ |
| 3 | The seller | Tell the PM "scrub checked" | ☐ |
| 4 | The seller | (For S-05, when asked) Export the **scrubbed build copy** as `.xlsx` into the project's `private/` folder ([D-019](decisions/D-019-photo-export-from-scrubbed-copy.md)) | ☐ |

Exit: The seller has confirmed the scrub. Agents may now run the migration, S-04 and S-05 against the build copy.

---

## G1: Staging review (end of Slice 3)

| # | Who | Step | Done |
|---|---|---|---|
| 1 | PM | Send the slice summary with 390 px screenshots and the staging Pages link | ☐ |
| 2 | The seller | On her phone, open the staging link: browse, reserve, open WhatsApp (send only to herself or not at all), back out | ☐ |
| 3 | The seller | In the **Google Sheets phone app**, on the build copy's `Claims` tab, change a `State` dropdown to `sold` and check the site and `Sold` tab update (S-15). If it doesn't react straight away, check again after the 10-minute timed job | ☐ |
| 4 | The seller | Review design, copy and photo crops (S-05 contact sheet) | ☐ |
| 5 | The seller | Note whether browsing feels too slow (if so, N-05 is the option) | ☐ |
| 6 | PM | Turn feedback into tickets or bugs. Record any decisions | ☐ |

Exit: The seller approves Slice 3, or lists the changes she wants.

---

## G2: Cutover (S-18). DRAFT

> **DRAFT.** Finalised in S-18 after S-16 and S-17 are Done. This is the first time anything touches the real sheet.

Before starting: S-17 is Done (all T-01 to T-18 pass, budgets met, no S1 or S2 open, repo history clean). The script version to deploy is tagged.

| # | Who | Step (brief S-18) | Check | Done |
|---|---|---|---|---|
| 1 | The seller | Announce a short pause in the group. Stop taking comment reservations on the real sheet. **Back it up** (make a copy, or name a version in version history) | Backup exists | ☐ |
| 2 | The seller | Approve the text fixes (list below) | Approved list | ☐ |
| 3 | The seller + Agent | Attach and push the script to the real sheet. Run the migration, and **compare the printed counts with the current sheet** | Counts match | ☐ |
| 4 | The seller | Set Script Properties `SELLER_WHATSAPP` and `SITE_URL` in the script's settings (never in the repo or chat). Deploy the web app. Install the triggers. Point the site at the new API URL | Site loads real catalogue | ☐ |
| 5 | The seller | **Turn off public sharing of the sheet.** Confirm from a logged-out (private) browser window that the sheet can't be opened. **Launch blocker** (D-011) | Logged-out check fails to open | ☐ |
| 6 | The seller + Agent | Test with a hidden test item: reserve, back out, sell, then remove the item and its test rows | Loop works, test data gone | ☐ |
| 7 | Agent, then the seller | Agents draft a short group message. The seller reviews it and posts it herself | Posted | ☐ |

**Text fixes for approval (brief 6.4):** "Bandminton" → "Badminton", "camr" → "came", "stil" → "still", "renovable" → "removable", "Phillips" → "Philips".

**Rollback (draft):** if step 3 or 6 goes wrong, restore from the step 1 backup and tell the group the pause continues. To be detailed in S-18.
