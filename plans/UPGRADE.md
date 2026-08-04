# Refreshing Grist Desktop

A plan for giving Grist Desktop the polish a native desktop app is expected to
have, so it reads as "a local spreadsheet app" rather than "the Grist web
service wrapped in Electron."

## Why now

The push came out of the Flathub submission for Grist Desktop
([flathub/flathub#8455](https://github.com/flathub/flathub/pull/8455)). The
review stalled on the app's rough edges — most visibly *that sad menu bar* and
leftover online-service artifacts — with the reviewer reading it as a thin web
wrapper rather than a real desktop app.

Two honest framings from the thread set the tone:

- It "definitely isn't a priority (there's no money in it), and that does show
  in the lack of polish" — but the underlying spreadsheet is excellent because
  the engine is shared with every other Grist build.
  ([comment](https://github.com/flathub/flathub/pull/8455#issuecomment-4578904089))
- The reviewer pushed back hard on treating it as a packaging-policy problem
  instead of a quality problem.
  ([comment](https://github.com/flathub/flathub/pull/8455#issuecomment-4552123649))

The concrete to-do list below is built on @wvengen's walkthrough in
[gristlabs/grist-desktop#105](https://github.com/gristlabs/grist-desktop/issues/105#issuecomment-4602675297),
cross-referenced against the current desktop code.

## Guiding principle

**Lean on Grist's own UI; don't bolt a desktop chrome on top of it.**

Everything a user needs already has a home inside the Grist interface. So rather
than *duplicating* actions into a native menu bar (and ending up with some
actions only reachable from the menu), the direction is:

1. **Remove** desktop chrome and online-only surfaces that don't apply locally.
2. **Adapt** the remaining surfaces to speak the language of local files.
3. **Gate** anything that *is* relevant in server/multi-user mode behind the
   condition that makes it relevant (e.g. an auth method is enabled), so people
   running Grist Desktop as an impromptu server still get those controls.

Condition matters throughout: most "hide this" items below should be "hide this
*unless* `GRIST_DESKTOP_AUTH` is `mixed`/`none` or a login method is enabled."

---

## Workstream 1 — Strip the desktop chrome

### 1.1 Remove the menu bar
The single most-cited eyesore. Other Electron apps wrapping web UIs on Flathub
ship with no menu bar, and Grist already exposes everything in-app. Replace the
custom template with no application menu (or an empty one), keeping only
keyboard accelerators that have no in-UI equivalent.

- `ext/app/electron/AppMenu.js` — currently builds File/Edit/View/Window/Help
  via `Menu.buildFromTemplate()` / `Menu.setApplicationMenu()`.
- `ext/app/electron/GristApp.ts` — sets the menu and wires File→New / File→Open
  handlers; these need new homes in the Grist UI (see 2.x) before the menu items
  go away.
- `ext/app/electron/WindowManager.ts` — `autoHideMenuBar` / window options.
- **Caveat:** audit for menu-only actions first. Anything only reachable from
  the menu (e.g. New/Open, dev tools, fullscreen) needs an in-app path or an
  accelerator before removal. macOS still needs a minimal app menu for
  Quit/Hide/Services — plan a platform split.

### 1.2 About / version
With the native menu gone, expose app + core version somewhere discoverable
(About box reachable from Grist settings, or the settings panel itself) instead
of the menu's native `role: 'about'`.

---

## Workstream 2 — De-cloud the in-app UI

These live in grist-core's client, surfaced/configured by the desktop layer.
Several are already partially hidden via `GRIST_HIDE_UI_ELEMENTS`
(`ext/app/electron/config.ts`); the goal is to finish the job and make the
remaining copy local-first.

### 2.1 Remove references to multiple sites
Multi-site / org switching has no meaning on a single local install. Audit
what `GRIST_HIDE_UI_ELEMENTS` already suppresses (`multiSite`, `multiAccounts`,
`billing`, `templates`, `helpCenter`, `tutorials`) and extend to anything still
leaking org/team language.

### 2.2 Remove / rethink the user menu ("Y" for "You")
The avatar/user menu in the top-right implies an account system that mostly
doesn't apply locally. Hide it by default; see the identity question below for
the nuance.

### 2.3 Account settings → Preferences
- Rename "Account settings" to "Preferences" / "Grist settings."
- Remove "Password & security" — **unless** a login method is enabled (server
  mode), where it's legitimately useful.
- Add "Check for updates" here (replacing the menu item). Not needed for the
  Flathub build, but valuable for the AppImage.

### 2.4 "Manage users" dialog
- "Inviting" users doesn't actually send an invite locally — either remove or
  reword so it doesn't promise something it can't do.
- Decide its role for the local case (see roles/permissions open question).

### 2.5 Broken / irrelevant surfaces
- "Document settings" → "API console" can't find Swagger (missing files) — fix
  the asset path or hide it.
- "Sharing menu" → "Download document…" is superfluous when the file is already
  local. Same on the "All documents" doc menu. Remove in the local case.

---

## Workstream 3 — Make it feel like working with local files

### 3.1 Opening files is the primary action
"Home → Add new → Import document" is how you open an existing `.grist` file,
but the label reads like an import. Rename to **"Open document"** and/or give it
its own prominent (green) button. This is the single biggest "it's a desktop
app" affordance.

- `ext/app/client/ui/NewDocMethods.ts`, `ext/app/client/ui/HomeImports.ts` —
  doc creation/import entry points.
- Consider replacing the HTML5 `openFilePicker()` import path with the native
  open dialog already used elsewhere (`GristApp.ts` `showOpenDialog`), so the
  open/import experience is consistently native.

### 3.2 File associations / dialog filters
When opening a file, the dialog shows "Customized Files" instead of the actual
extensions (`.grist`, importable types) — the web version gets this right. Fix
the filter list in the native dialog config (`GristApp.ts` open/save dialogs).

### 3.3 Duplicate / "Work on a copy" should land on disk
- Duplicating a document currently saves it somewhere inside the Flatpak
  sandbox, invisible to the user. On duplicate / "Work on a copy," prompt for a
  real on-disk location (native save dialog).
- Multi-window bugs in this flow:
  - After "Work on a copy," the "Return to original" → open-in-new-window link
    opens a new Grist window; closing the copy window also closes that new
    window.
  - After "Work on a copy" → "compare to original," a new window opens that
    **cannot be closed**.
  - Track these against `WindowManager.ts` window lifecycle / ownership; they
    line up with the known multi-window CDP fragility noted in
    `plans/ADDING_TESTS.md`.

---

## Open questions (need a product decision before coding)

These are genuine forks, mostly around identity and the "edit locally, upload
to an online instance later" flow. Worth resolving up front because they decide
how much to hide vs. reword.

1. **Is the user name / email relevant locally?**
   - It surfaces in comments and document history (authorship metadata), so it's
     not purely cosmetic.
   - Option: allow editing it as document metadata, the way office software lets
     you set an author name — but explained, and not in-your-face. If it's *not*
     wanted, hide it entirely (ties to 2.2).
   - What should happen to this identity when a locally-edited doc is later
     uploaded to an online instance?

2. **Roles & permissions edited locally?**
   - Can a user edit roles/permissions locally, upload, and have them applied?
     Is that a desired flow, or is configuring sharing fresh on the server
     cleaner? This decides the fate of "Manage users" (2.4) and whether local
     role editing stays.

3. **The "impromptu server" use case.** Several removals above should be
   *conditional*: when Grist Desktop runs with a login method enabled, the
   multi-user surfaces ("Password & security," Manage users, roles) become
   genuinely useful. Settle the condition (auth mode) that toggles each.

---

## Suggested phasing

1. **Phase 1 — visible wins for Flathub:** remove the menu bar (1.1), rename
   Import→Open + prominent button (3.1), fix file-dialog filters (3.2), hide
   user menu + multi-site refs (2.1, 2.2). These are what the review actually
   sees.
2. **Phase 2 — settings & cleanup:** Preferences rename + conditional
   Password/security + check-for-updates (2.3), remove superfluous Download /
   fix API console (2.5), reword Manage-users invites (2.4).
3. **Phase 3 — local-file correctness:** duplicate-to-disk + the "Work on a
   copy" window bugs (3.3). These touch real window-lifecycle logic and overlap
   with multi-window test gaps.
4. **Cross-cutting:** the identity / roles decisions (open questions) gate parts
   of every phase — decide early even if implemented late.

## Notes for implementation

- Most UI suppression flows through `GRIST_HIDE_UI_ELEMENTS` and the desktop
  config in `ext/app/electron/config.ts`; prefer extending that mechanism over
  forking core client code where possible, so changes stay maintainable across
  core updates.
- Keep every removal *conditional on auth/server mode* (see open question 3) so
  the impromptu-server users aren't stranded.
- Multi-window items will be hard to verify by hand — they're good candidates
  for the nbrowser-on-Electron harness described in `plans/ADDING_TESTS.md`.
