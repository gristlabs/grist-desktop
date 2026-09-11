# A third way to test the desktop app: run it as a server

Branch `paulfitz/deployment-tests` in `/home/paulfitz/cvs/grist-desktop`, one commit. Supersedes
the older local branches `consolidate-tests` and `deployment-tests`, the latter being the same idea
as a standalone `scripts/test-deployment.sh`; this folds it into the existing runner instead. Both
can be deleted once this lands.

Two local branches hold earlier shapes of the same work, in case anything needs recovering:
`backup/deployment-tests-3commits` is the history before it was squashed, and
`backup/deployment-tests-squashed` is that commit as it stood before review.

## The problem

Grist Desktop is the Grist server wrapped in Electron. Almost all of its behavior is upstream's,
so its browser tests are borrowed wholesale from grist-core: thirteen suites out of
`core/_build/test`, run by `scripts/test-electron.js --upstream`, which CI runs on every platform.

Those borrowed suites were written to drive a browser against a server. Desktop has no separate
browser -- the Electron window is the browser -- so the runner makes the window impersonate one.
`test/electron/setup.js` is what that costs: a socket for upstream's testing hooks, a stand-in for
the server object upstream's tests expect to find, and patches over the selenium window methods
that do not mean the same thing inside Electron. It works, but every borrowed suite is one upstream
change away from needing another shim, and two suites (ReferenceColumns, ReferenceList) have never
run at all.

Worse, the window modes force `GRIST_SANDBOX_FLAVOR` to unsandboxed. The sandbox is how Grist runs
user formulas, and the one we ship is not the one under test. Everything the tests say is therefore
about a configuration no user has.

## What the branch does

Adds a `--deployment` mode (`yarn test:electron:deployment`). It starts the app as an ordinary
Grist server on a port, waits for `/status` to say it is alive, and then runs the borrowed suites
in a real Chrome pointed at `HOME_URL`. This is what core already does against its docker image;
`core/test/test_under_docker.sh` is the model, and it is worth reading alongside
`scripts/test-electron.js`.

Nothing from `test/electron/setup.js` is involved. The suites run unchanged.

The trick that makes it work is `GRIST_TEST_LOGIN`. Desktop replaces Grist's login with a
single-user one, which the borrowed suites know nothing about. Core prefers its own test login when
that variable is set, so desktop's login steps aside and upstream's fixtures apply.

Because nothing needs to be forced, the mode deliberately unsets `GRIST_SANDBOX_FLAVOR` and lets
the app pick. The runner prints which flavor actually ran, since that is the point.

`GRIST_DESKTOP_BIN` points the mode at a packaged binary rather than the build tree, which is how
it would eventually test a real artifact.

## What using the real sandbox cost, and the fix

Putting the mode in CI is what turned up the substance of this work, and it is worth reading the
order it happened in, because the first two diagnoses were wrong.

CI went red on three of four platforms with what looked like noise: socket hang-ups, click
interceptions, hook timeouts, script timeouts, whole suites failing at once. Two things were needed
to see past it.

The first was keeping the **server's** log, not only the browser's. `runDeployment` now writes it
outside the temp state directory it tears down on the way out, and CI uploads it on failure. When a
browser test fails, the server's account of what happened is usually the only place the reason is
recorded, and by then the directory holding it is gone.

The second was not trusting the failure count. Twenty-eight failures on the Intel Mac were about
nine real ones. Mocha suites share state: `ActionLog` applies an access rule in its first test and
removes it at the end of that same test, so one timed-out request left the rule in place for
the nine tests after it, and `ChoiceList` creates its document inside its first `it()` rather than a
`before()`, so one failure took eight more with it.

What was left, once those were stripped away, was a single cause. Deployment mode uses the sandbox
we ship, which off Linux is pyodide, and pyodide loads an interpreter and a set of packages before
it can answer anything. Timed from the CI artifacts, 22 sandbox launches per run per platform:

| platform | first call, median | p90 | worst | over 5s | later calls, median |
|---|---|---|---|---|---|
| ubuntu-22.04 | 3746ms | 7497ms | 7906ms | 18% | 2ms |
| windows-2022 | 3910ms | 8814ms | 9062ms | 18% | 3ms |
| macos-15-intel | 10127ms | 34213ms | 37527ms | 68% | 5ms |

The clincher was in the same run's log: `DuplicateDocument` passed at 13:32 in upstream mode, which
forces the sandbox off, and failed at 13:41 in deployment mode, which does not. Same machine, same
run, same test.

Upstream's helpers default to 5000ms for a round trip to the server and 10000ms for a document to
appear. Those numbers are an assumption about sandbox flavor, and it stops holding for the flavor
this mode exists to exercise.

`test/electron/deployment-timeouts.js` is a mocha `--require` plugin that raises the floor under
those three helpers, defaulting to 30s and configurable with `GRIST_TEST_SERVER_TIMEOUT`. It is a
floor and not an override, so a caller that already asked for longer keeps what it asked for.
Mocha's own per-test limit is derived from the same number in `scripts/test-electron.js`, since a
suite that creates a document can spend two of these before running any of its own code.

Three things about it worth knowing before changing it:

- **Why patching the prototype works.** `gristUtils` binds the helpers off the prototype the first
  time it is imported (`webdriverUtils.waitForServer.bind(webdriverUtils)`), and mocha loads
  `--require` plugins before any test file. So the patch lands first. Do this any later -- in a root
  hook, say -- and the bound copies will already have been taken, and the patch will silently do
  nothing except for calls made from inside the class.
- **Why the plugin re-exports `mochaHooks`.** Requiring the helpers pulls in `mocha-webdriver`,
  which installs the hooks that create the browser with a bare `before()`, but only
  `if (typeof before !== 'undefined')` -- which is false inside a `--require` plugin. It skips them
  silently and expects the early loader to pass on `getMochaHooks()` instead. Without that line
  every suite fails its "before all" hook with `WebDriver accessed before initialization`.
- **Why it also raises the per-test timeout.** A helper allowed to wait longer than the test
  containing it is not waiting at all. `ActionLog`, `ChoiceList`, `DuplicateDocument` and
  `ReferenceColumns` each open with `this.timeout(20000)`, and a suite's own number beats mocha's
  `--timeout`, so the first version of the plugin raised the helpers to 30s inside tests that died
  at 20s. The floor is now applied to the test as well, from a root `beforeEach`, on `currentTest`
  rather than on `this` -- the latter would set only the hook's own limit.
- **Where the idea came from.** grist-static does the same thing at a larger scale, shadowing whole
  upstream test modules by NODE_PATH order so unmodified core suites run against its own versions;
  see `scripts/test_nbrowser.sh` and `ext/test/nbrowser/homeUtil.ts` in that repo. This needs only
  default arguments changed, so it patches in place rather than shadowing a module.

With the floor in place, ReferenceList -- dropped from the suite list earlier precisely because its
three `sendActions` calls sat right on the 5s limit, and were seen both to pass and to time out on
the same machine -- passes against pyodide, and is back in.

## The other half, which is not in this repo

Raising a timeout does not make anything faster. The other end of the same problem is starting the
sandbox before a document asks for one, which is branch `pyodide-sandbox-pool` in
`/home/paulfitz/cvs/claude/grist-core`; see `plans/PYODIDE_SANDBOX_POOL.md` there.

They are complementary and neither replaces the other. The pool cuts the first open of each
document from seconds to a few hundred milliseconds; it can do nothing about a burst of documents
opening at once, which is most of what a test suite does. The floor covers the burst and improves
nothing a user would feel.

## The Windows failure, and what it was really about

`ReferenceColumns` failed on Windows and nowhere else, deterministically: `should render first
items when opening empty cell` clicks an empty School cell, presses Enter, reads the reference
editor's dropdown, and gets the *Color* column's items back.

The first diagnosis was a stale autocomplete read -- `driver.findWait` waits only for the menu to be
*present*, which the previous keystroke's menu already satisfies. A fix for that is upstream in
grist-core, released in v1.7.18: the menu carries a `data-ac-search-text` attribute set after its
items, and a `gu.autocomplete` helper waits for the text it wants. It is a reasonable hardening and
it fixed nothing here, which should have been predictable: **this test performs no keystrokes
between its two menu reads**, so the mechanism cannot apply to it. The diagnosis was a race found by
reading, fitted to a failure it does not explain. The upstream commit's justification is wrong even
though the change is not, and that is worth correcting on the record.

Dumping the page at the failing assertion settled it. The cursor was on **Color row 4** -- the
previous step's cell -- both at the read and after it, with a single dropdown, correctly tagged for
that editor. **The click on the School cell never moved the cursor**, and Enter reopened the editor
where it already was. Nothing about autocomplete was involved.

The test cannot notice, because its only check on the cell it clicked is `getText() === ""`, and the
cell it wrongly stayed on is empty too. Every other close-click-read sequence in the file asserts
distinguishing text, which is why this one test and no other exposed it.

Why the click was lost is a question about geometry, and the answer is that we never controlled it.
Mocha resolves its config by searching up from the cwd, and the runner ran mocha from this repo's
root -- so core's `"mocha"` block, which is how every core mocha run loads `setupPaths` and
`init-mocha-webdriver`, was never found. Window size was therefore whatever the runner's desktop
happened to give: 1028x637 on the windows runner, 1030x1322 on a developer machine. The runner now
runs mocha from core's directory, and takes the rest of the environment from how core runs these
suites itself, headless included -- which is what fixes the geometry at 1920x1080, since core's
`testUtils` overrides the init file's 1024x640 when headless. Same question on every platform.

Two things about that are worth keeping in mind. The narrow window is a plausible cause of a lost
click and not a demonstrated one; a developer machine at 1030 wide passed. And the same cwd mistake
was silently dropping chai's truncation threshold, stacktraces, and the automation banner
suppression that upstream added *because the banner can swallow early clicks*.

The shape of the mistake is worth more than the mistake. Pieces of what those two config requires
do had been re-derived by hand -- `NODE_PATH`, `SELENIUM_BROWSER` -- one visible failure at a time,
which gets you only the pieces whose absence is visible. Adopting core's own entry point gets the
rest.

The page dump that settled the diagnosis was a temporary mocha plugin, since removed; it recorded
the cursor position and the dropdowns present at the failing read.

## The `socket hang up` on macos-15-intel

`ActionLog` failed its first test with a `socket hang up` from node-fetch on `/apply`, and took nine
more down with it, since that test applies an access rule and removes it at its own end. It happened
on every macos-15-intel run and on no other platform, and the cause was in neither this repo,
Electron, nor the runner.

`follow-redirects` adds a `socket.destroy` listener to the `timeout` event of each keep-alive socket
axios uses, and does not remove it. axios calls `req.setTimeout` whether or not a timeout was
configured, so this applies to every axios request. The socket returns to `http.globalAgent`'s free
pool with the listener attached, and since node 19 that agent sets a five second idle timeout on
pooled sockets -- node's own handler destroys a socket only while it is in the free list, the
leftover one destroys it in any state. So the next caller to take that socket has it closed five
seconds into any request the server is slow to answer. Here that caller is the first
`applyUserActions` of the suite, and the axios request before it is core's own `importFixturesDoc`
uploading the fixture in a `before` hook. Nothing about this is specific to macs: it is hidden
wherever the server answers within five seconds, and mac-intel is the only runner whose first
pyodide call routinely does not.

Fixed in core by giving axios its own connection pool, so the sockets it changes are only reused by
axios, where the leftover listener has no effect -- `follow-redirects` sets the socket timeout at
the start of each request it handles and axios passes 0, so on that pool the timeout is disabled.
Nothing global changes. Two alternatives were measured and work as well -- disabling the global
agent's idle timeout, and removing the listener in `Agent.keepSocketAlive` -- but both change what
node does with every socket in the process.

## What is left

- Whether 30s is enough on macos-15-intel is the one number this design is not sure of: its p90
  first sandbox call is 34s. `GRIST_TEST_SERVER_TIMEOUT` is the knob if it turns out not to be.
- Whether the timeout floor should apply in upstream mode too. It is deployment-only today on the
  reasoning that pyodide is what makes 5s too tight, but `ChoiceList` has been seen to fail on
  ubuntu in upstream mode -- where the sandbox is off -- with a 5178ms wait timeout, in a stretch of
  tests that habitually run 5.1-5.4s. The 5s default is tight for these suites on CI hardware
  whatever the flavor.
- Decide whether raising upstream suites' own timeouts from a plugin is the right shape. The
  alternative is a core pull request lifting `this.timeout(20000)` in the four suites that declare
  it, which is more honest and less local special-casing, but is a change to someone else's tests
  for the benefit of a mode they do not run.
- Consider adding `DropdownConditionEditor` to the deployment suites. It is not in the list, but it
  passes in deployment mode and it exercises the same autocomplete.
- `testSandboxFlavor()` in core probes a candidate sandbox with a 5-second timeout. On a machine
  where pyodide's median start is 10s it will report that pyodide does not work, and
  `SandboxSection.ts` and `QuickSetup.ts` both pre-warm providers through it. That is a live bug in
  what we ship, found by reading rather than by a test.
- Decide whether the window modes are still worth keeping once this covers the same suites. The
  argument for keeping one is that it exercises the Electron window itself, which deployment mode
  never touches.
- Drop the `scripts/setup.sh` pyodide workaround in favor of `make setup`. Deliberately left out of
  the CI experiment so as not to confound it.
- Delete the `deployment-tests` branch.
