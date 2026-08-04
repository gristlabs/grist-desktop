# Running upstream nbrowser tests against grist-desktop

## What we have

A mocha-webdriver harness that drives the real grist-desktop Electron binary
via `electron-chromedriver` (now: standalone `chromedriver@134` to match
Electron 41's Chromium), runs unmodified test files from grist-core, and uses
`HOME_URL` to put upstream's `testUtils.ts` into "external server" mode.

Pieces:
- `test/electron/setup.js` — mocha `--require` plugin: env, Electron launch,
  pre-login via `/test/login`, runtime monkey-patch of selenium's
  `Window.prototype.getRect`/`setRect` so the missing CDP `Browser` domain
  on Electron doesn't blow up window-resize calls.
- `test/electron/Smoke.test.js` — a couple of harness-sanity tests.
- `scripts/test-electron.js` — cross-platform runner. On Linux, re-execs
  under `xvfb-run` with Wayland/D-Bus env stripped so native dialogs can't
  escape to the host session. On macOS / Windows, runs directly (CI runners
  have a real display). Sets `NODE_PATH=core/_build/ext:core/_build/stubs:core/_build`
  so ext shadows beat upstream.

Patches in product code, all gated:
- `ext/app/electron/main.ts` — under WebDriver, allow unknown commander
  options (Chromium switches), stub `electron.dialog.show*` to return
  synthesised paths.
- `ext/app/electron/config.ts` — let `GRIST_FORCE_LOGIN` from env win.
- `ext/app/server/lib/create.ts` — when `GRIST_TEST_LOGIN=1` and
  `TEST_SUPPORT_API_KEY` are set, return `TestLoginSystem` instead of
  `ElectronLoginSystem`. The only thing this actually changes is
  `addEndpoints()` seeding the support user's API key onto the home DB,
  which `setupRequirement({team: true})` needs to create the test-grist org.

## Coverage

Roughly 90 upstream tests passing across about a dozen suites with no
test-file forks and no `homeUtil` shadow. Headline suites green or near it:
Pages, ChoiceList, DuplicateDocument, LeftPanel, DetailView, ToggleColumns,
CopyPasteLinked, FilteringBugs, ColumnTransform, plus Smoke and ActionLog.

Known failure shapes still to attack:
- `Fork` — "cannot determine loading status" on every test. New shape after
  enabling TestLoginSystem.
- Multi-window CDP failures (`'handle' must be a string`) — same family as
  `Browser.getWindowForTarget`. Tests that switch between windows.
- Selector mismatches against the desktop's custom home UI (Features,
  SelectByRightPanel) — case-by-case.
- Various assertion mismatches inside otherwise-running suites
  (CopyWithHeaders, ReferenceList) — likely plain bugs in our pyodide path
  or environment differences.

## Unexplored: testing-hooks socket for login

The current setup uses `HOME_URL` so upstream's `testUtils.ts` enters
"external server" mode, and `homeUtil.simulateLogin` then drives the
`/test/login` HTTP form. This works.

A more "with-the-grain" alternative is to expose grist-core's
`GRIST_TESTING_SOCKET` from the desktop server and use the testing-hooks
code path that nbrowser tests normally use:

- Set `GRIST_TESTING_SOCKET=<path>` in `setup.js` before launching
  Electron. `FlexServer` already creates the unix socket when this is
  set; nothing needed on the desktop side.
- Don't set `HOME_URL` (so `isExternalServer()` is false).
- Shadow `core/test/nbrowser/testServer.ts` (~30 lines) so its `start()`
  *connects to the existing socket* instead of spawning a child process,
  and so `getHost()` returns the address the desktop server is already
  bound to.

`simulateLogin` would then go through `testingHooks.setLoginSessionProfile`,
not `/test/login`. Tests that rely on testingHooks for things other than
login (server pause, etc.) would also start working.

The support-user-API-key seeding still needs to happen somewhere; either
keep the `create.ts` swap, or move the equivalent DB write into the
testServer shadow's startup.

This is unexplored. Documented here so the option isn't forgotten.

**Concrete reasons the socket approach would likely be better, observed
empirically while chasing tests in the HTTP/external-server mode:**

- The pre-login workaround in `setup.js` (navigate to `/test/login` with the
  default user before tests start) is needed to make tests like Smoke that
  *don't* call simulateLogin pass — but it confuses tests that *do* call
  simulateLogin (Search2 etc.), because simulateLogin's HTTP path expects
  to land on the login form and clicks `.test-user-sign-in` if not. With
  testing hooks, login is per-session-id and doesn't share cookies, so
  this whole class of conflict goes away.
- Tweaking `unhandledPromptBehavior` capability traded one suite's
  passes for another's failures, because navigation-vs-alert timing is
  fragile in HTTP mode. Hooks-driven login wouldn't trigger the same
  navigation churn.
- `simulateLogin` already has a clean code path for the hooks case
  (`setLoginSessionProfile`); we're not wiring it up.

## Upstream Smoke is omitted

`core/test/nbrowser/Smoke.ts` tests cloud Grist's *anonymous-fork-create*
flow: an unauthenticated user clicks "Start a new document" on the home
page, gets redirected into an in-memory unsaved doc, and edits it. Desktop
docs are file-backed and owned by the default user, so the anon flow has no
analog — clicking the equivalent button creates a doc owned by
`you@example.com` that an anonymous WebDriver session can't access.

The runner skips upstream Smoke from defaults; pass it explicitly with
`./scripts/test-electron.js --upstream Smoke` if you want to see it fail.
A desktop-equivalent smoke test lives in `test/electron/Smoke.test.js`.

## Things explicitly punted

- `homeUtil.ts` shadow for path-keyed-vs-id-keyed doc storage. Probably
  necessary eventually for tests that create/copy/share docs through
  cloud-style API paths.
- Tests that exercise multi-team-site UI (HomeIntro mostly). Not worth
  porting — desktop has one workspace.
- Multi-window operations. Need a Selenium-level shim or skip.
