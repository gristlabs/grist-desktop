# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Grist Desktop — an Electron app wrapping [grist-core](https://github.com/gristlabs/grist-core/) to run Grist spreadsheets locally without internet. Documents are stored as `.grist` (SQLite) files on disk.

## Build & Run

```bash
git submodule init && git submodule update
yarn install
yarn run setup          # downloads Python runtime, creates symlinks, sets up Pyodide
yarn run build          # builds grist-core (TS + webpack) then resolves ext path aliases
yarn run electron:preview  # run the app in dev mode (no packaging)
yarn run electron       # package with electron-builder (all platforms)
```

Platform-specific packaging: `yarn run electron:linux`, `yarn run electron:ci` (uses `scripts/ci.sh` with arch flags).

## Testing

```bash
yarn run test           # runs scripts/smoke-test.sh (CLI version check + SQLite query test)
```

There is no unit test suite for the desktop layer. The smoke test runs headless Electron CLI commands against a fixture `.grist` file. grist-core has its own extensive test suite (mocha, WebDriver) but it's run separately within `core/`.

## Project Structure

This is a **yarn workspaces** monorepo with two packages: `core` (git submodule → grist-core) and `ext` (desktop-specific code).

### `ext/` — Desktop extension layer

All desktop-specific code lives here. It's linked into grist-core's build via `core/ext` symlinks created by `scripts/setup.sh`.

- **`ext/app/electron/`** — Electron main process
  - `main.ts` — Entry point. CLI arg parsing (commander.js), single-instance lock, file-drop handling. Supports `--cli` mode for headless operations.
  - `GristApp.ts` — Singleton orchestrating the app: starts MergedServer, manages WindowManager, handles document open/create/import via IPC.
  - `WindowManager.ts` — Maps doc IDs to BrowserWindow instances.
  - `config.ts` — Loads `.env` config (auth mode, sandbox flavor, host/port).
  - `LoginSystem.ts` — Desktop auth with three modes: `strict` (no network), `mixed` (anon network), `none`.
  - `preload.ts` — Context bridge exposing `createDoc`/`importDoc` to renderer.
- **`ext/app/server/lib/`** — Server-side extensions
  - `DesktopDocStorageManager.ts` — Maps doc IDs ↔ filesystem paths, syncs home DB with disk.
  - `create.ts` — `ICreate` implementation plugging in desktop storage + login system.
- **`ext/app/client/`** — Renderer-side extensions for doc creation and import UI.

### `core/` — grist-core submodule

The full Grist engine (server, client, Python sandbox, plugins). Desktop code imports from it using path aliases like `app/server/lib/...` which resolve to `core/_build/...` at runtime.

**Build output** goes to `core/_build/`. The main entry point for Electron is `core/_build/ext/app/electron/main.js`.

### Key symlinks (created by `scripts/setup.sh`)

- `app` → `core/app`, `buildtools` → `core/buildtools`, `stubs` → `core/stubs`
- `tsconfig.json` → `core/tsconfig-ext.json`
- `core/ext` → symlinks to contents of `ext/` (for the build to pick up desktop code)

## Architecture Notes

- The app starts a full Grist HTTP server (MergedServer with home/docs/static/app routes) on localhost with a random port, then opens BrowserWindows pointed at it.
- Python sandboxing defaults to Pyodide (WASM). Other options: gvisor (Linux), macSandboxExec (macOS), unsandboxed.
- The `DesktopDocStorageManager` is the key difference from hosted Grist — it treats the local filesystem as the source of truth instead of cloud storage.
- TypeScript compilation uses `tsconfig-ext.json` which extends core's config to include the `ext/` sources. Path aliases are resolved post-build by `resolve-tspaths`.

## Environment Variables

Key vars for development (can be set in `.env`):

- `GRIST_DESKTOP_AUTH` — `strict` (default, no network), `mixed`, `none`
- `GRIST_SANDBOX_FLAVOR` — `pyodide` (default), `gvisor`, `macSandboxExec`, `unsandboxed`
- `GRIST_HOST` / `GRIST_PORT` — server bind address (default: localhost, random port)
- `GRIST_INST_DIR`, `GRIST_DATA_DIR`, `GRIST_USER_ROOT` — storage paths
