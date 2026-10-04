# SPOPI agent guide

This file contains repository-wide development rules. The documentation map:

| File | What it answers |
|---|---|
| [`docs/FEATURES.md`](docs/FEATURES.md) | What every feature does for the user, how to reach it, how to configure or turn it off, its limits, and which Pi piece it relies on |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Rules the code must keep: transport, security and host boundaries, module ownership, each feature's invariants |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design tokens and UI primitives |
| [`docs/RPC_COVERAGE.md`](docs/RPC_COVERAGE.md) | Every Pi RPC command and event: handled, unused, or forbidden |
| [`docs/PI_BUMP.md`](docs/PI_BUMP.md) | Bumping the embedded Pi and the updater key |
| [`CHANGELOG.md`](CHANGELOG.md) | Short release notes, one section per version; `release.yml` uses the tag's section as the GitHub release text |
| [`README.md`](README.md) | The short pitch and how to run |

## Read first

- Before answering what SPOPI does or changing a feature, read its section in
  `docs/FEATURES.md`. Before changing how it works, read the applicable
  `ARCHITECTURE.md` section and its linked design documents. This applies to UI
  behavior, persistence, workspace I/O, and cross-process communication.
- Update `docs/FEATURES.md` in the same change when a user-visible behavior,
  label, shortcut, setting, default, file location, or limit changes, or a
  feature is added or removed. Keep its section format (Use, Configure, Limits,
  Pi, Code).
- For each user-visible change, add one short line to `CHANGELOG.md` under the
  next version (`## X.Y.Z`), in a **Features** or **Fixes** list.
- Update `ARCHITECTURE.md` when an implementation materially changes its
  architecture, invariants, lifecycle, security boundary, or validation
  contract. Changes to LAN access, cross-platform paths, or static serving also
  require the corresponding architecture update.

Tauri wraps the web UI. Rust starts a native `HostServer` plus a managed `pi --mode rpc` subprocess using the embedded pi binary shipped in `src-tauri/resources/pi/` (downloaded by `scripts/fetch-pi-binary.js` from pi-mono releases at the version pinned in `scripts/pi-version.json`). The WebView talks to the Rust host over `/v2/ws`; the host bridges runtime requests to Pi over stdio RPC.

```
SPOPI .app
  resources/
    public/                        (frontend)
    extensions/                    (bundled Pi extensions, wasm, verify skills)
    skills/spopi-customize/        (bundled skill)
    pi/<bun-compiled pi binary + assets>
  Rust HostServer + PiRuntime
    spawn pi --mode rpc --extension spopi-bridge.mjs …
    WebView  →  /v2/ws  →  HostServer  →  stdio RPC  →  pi
```

Runtime, data, auth, and extension UI traffic goes through the native host protocol (`/v2/ws`). The six Tauri commands in `src-tauri/src/commands.rs` are only for native window and workspace actions the WebView cannot do: pick a folder, relocate a missing project, open another project or session in a window, show a task notification, and retry a failed start. Do not add Tauri commands for Pi, files, git, or preferences.

### Goals

- Local desktop GUI: all projects and agents visible in one app
- Multi-project: each project has its own window, isolated working directory, session history, and running agent
- Multi-agent: spawn new agents per project; switch between sessions without leaving the app
- Native runtime protocol: browser frames are routed by Rust over `/v2/ws`, then forwarded to the managed Pi process over stdio RPC.
- Visualization: streaming chat, tool-call cards, thinking blocks, token/cost tracking per session
- Fully self-contained desktop app: zero dependency on the user's PATH / shell environment / globally installed pi

### Constraints

- Frontend: vanilla JS, no framework (`public/`)
- Backend: Rust (Tauri) owns process lifecycle, the HTTP/WebSocket host, routing, and host data APIs
- PI integration: always via embedded `pi --mode rpc` subprocess — never re-implement PI runtime logic
- Session history and working directory are isolated per project/port
- The embedded pi version is the source of truth: `pi --version` shown in the UI comes from `SPOPI_PI_VERSION` (set by Rust at spawn time, populated from `scripts/pi-version.json`). A user-installed pi on `$PATH` is irrelevant and never touched.
- User extensions under `~/.pi/agent/extensions/` and `<workspace>/.pi/extensions/` are still auto-loaded by the embedded pi (embedding doesn't disable user extensions).

### PI references

Docs ship inside the embedded pi runtime at `src-tauri/resources/pi/docs/` (populated by `bun run fetch:pi`; see "Bumping the embedded pi version" below). Prefer these repo-relative paths over any globally-installed `pi-coding-agent` — a global install may not exist on a given machine or may be a different version than the one pinned in `scripts/pi-version.json`.

- RPC protocol: `src-tauri/resources/pi/docs/rpc.md`
- SDK: `src-tauri/resources/pi/docs/sdk.md`
- Session format: `src-tauri/resources/pi/docs/session-format.md`
- JSON mode: `src-tauri/resources/pi/docs/json.md`

---

# Agent working notes

Conventions for any coding agent working in this directory.

## Agent skills

### Issue tracker

Issues and PRDs are GitHub issues. Use `gh` from this clone.

- Create: `gh issue create --title "..." --body "..."`.
- Read: `gh issue view <number> --comments`.
- List: `gh issue list --state open`.
- Comment: `gh issue comment <number> --body "..."`.
- Close: `gh issue close <number> --comment "..."`.

External pull requests are not a feature-request surface. A bare `#42` may be an issue or a PR; try `gh pr view 42` and fall back to `gh issue view 42`.

## Package manager

Use **Bun** exclusively. Never run `npm install` or `npm ci` — this would create a stray `package-lock.json` that drifts from `bun.lock` and confuses CI (`bun install --frozen-lockfile`).

```bash
bun install --frozen-lockfile   # install deps
bun run <script>                # run package.json scripts
```

## Common commands

```bash
bun run dev              # fetch embedded pi binary, then start tauri dev (hot reload)
bun run test             # vitest run
bun run test:watch       # vitest in watch mode
bun run check            # node scripts/check.mjs: biome, types, design, locales, and the other product checks
bun run smoke:stream     # one fake-provider session: tools, guard, export
bun run check:rust       # cargo check + clippy + tests + advisory fmt
bun run fetch:pi         # download the locked pi binary into src-tauri/resources/pi/
bun run build:extensions # compile spopi-bridge, pi-permission-system, spopi-verify, and spopi-tool-output into extensions/dist/
bun run build            # full release build (runs prebuild: fetch:pi + build:extensions:release, which leaves out the fake test provider)
```

Environment: `SPOPI_PI_VERSION`, `SPOPI_PI_VERSION_BUNDLED`, `SPOPI_SKIP_BIN_CHECK`, `SPOPI_HOST_PORT`.

Single test file: `bun run vitest run public/app/settings/settings-save-status.test.js`

## Searching the codebase

`src-tauri/target/` is a gitignored Rust build-artifact directory (like `node_modules`/`dist`) containing thousands of `.rcgu.o`/`.rlib` object files. `grep -r`/`rg` do not respect `.gitignore` by default, so a broad recursive search rooted at `src-tauri/` (instead of `src-tauri/src/`) will scan those binaries too — grep's binary-file heuristics can match embedded strings from dependencies and flood the output with thousands of meaningless object-file paths, burying the real hits and making the command look hung.

When grepping for source code, target the actual source directories directly — `public/`, `extensions/`, `src-tauri/src/` — never bare `src-tauri/`. Prefer `rg` (respects `.gitignore` by default) over `grep -r` when available.

When running `find` (or any other filesystem/code search command), scope it to this repo by default — root the search at the repo root or a specific subdirectory inside it (e.g. `find public -name '*.js'`, `find . -path ./src-tauri/target -prune -o -name '*.rs' -print`), never at `/`, `~`, or an unrelated ancestor directory. Only search outside the repo if the user explicitly asks for a global/system-wide search.

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for JS/TS linting and formatting.

After every frontend or extension edit, run the check before declaring the work done:

```bash
bun run check         # lint, format, design, locales, and the other product checks
bun run check:fix     # auto-fix safe Biome and design-token issues
```

### Rules

- **Always** run `bun run check` after editing any `.js` / `.ts` file under `public/` or `extensions/`.
- Only mark the task complete if `bun run check` exits 0 (or all remaining violations are intentional and documented).
- Prefer `bun run check:fix` over manual reformatting — Biome is the source of truth for style.

## Design system

Before editing CSS or UI controls, read [`docs/DESIGN.md`](docs/DESIGN.md). Use tokens from `public/style-theme.css` and primitives from `public/design-system.css`; do not add literal design dimensions. After CSS, UI markup, or inline-style changes, run `bun run check`.

## Module Design

The frontend (`public/app/`) is vanilla JS. Keep `app.js` as an orchestrator: put new feature logic in a dedicated module and import it explicitly. Do not mutate shared state as an import side effect. Use kebab-case filenames that describe one responsibility.

### Components

A component creates every node under `root` and never calls `getElementById` for a node it did not create. It talks to other components only through the session store or commands. DOM entry points are `mountX(root, deps)` and return `{ update, destroy, refs }`. Services are `createX(deps)`, have no DOM, and return methods plus `subscribe` when they hold state. A file holds one component or service, plus private helpers. `index.html` stays a shell of empty roots.

### Store

`createSessionRuntime(deps)` returns `{ getState, subscribe, dispatch, commands, start, switchSession }`. State is the target, session title and model, transcript, queue, status, tree, and dock or rail UI. Actions are `{ type: "rpc", event }`, `{ type: "snapshot", snapshot }`, and the file, terminal, message, composer, and editor actions. The store notifies subscribers after each dispatch. Reducers are pure and tested without a DOM.

### Types

JSDoc plus `tsc --noEmit`. There is no app build step. Pi types come from `@earendil-works/pi-coding-agent` through `public/app/types.js`. Use `unknown` and narrow it. Do not use `any`. Bridge extensions are TypeScript and share that `tsc` run. Opt a JS file in with `// @ts-check`.

### Keybindings

`createKeybindings()` returns `{ register, handle, list }`. A binding is `{ id, keys, labelKey, when, run }`. One registry per window, created in `app.js`. The slash menu and the `?` / `/hotkeys` overlay read `list()`. There is no top command palette. Editor bindings use `when: (ctx) => ctx.focus === "editor"`. Register OS shortcuts here (including `Mod+\`` for the terminal). Do not add a parallel keydown listener.

### Code standard

- Every `.js`, `.mjs`, `.ts`, and `.rs` file, and every `.css` file over 40 lines, starts with exactly two ABOUTME lines. Line one says what the file owns. Line two says its boundary. Tests name the module under test on line two.
- Entry verbs are `mountX(root, deps)` and `createX(deps)`. Do not export `setup`, `wire`, `init`, `attach`, `install`, or `bind`.
- The only page global is `window.spopi` (`capability`, `debug`). First paint uses the `spopi-appearance` cookie. Theme ids appear only in `app/theme/themes.js`, `style-theme.css`, and the first-paint script in `index.html`; a rule that differs for light themes keys on `:root[data-scheme="light"]`.
- Other GUI preferences are `ui.*` through `storage/ui-store.js`. Pi settings go through the bridge. Do not add `localStorage` or `IndexedDB` for preferences. `sessionStorage` holds three per-tab values that must die with the tab and are not preferences: the runtime client id (`sessionScopedClientId`), the project a window just left (`session/window-project.js`), and the instance-swap flag (`spopi:swapping-instance`).
- Feature CSS sits next to the module and is listed in `public/stylesheets.json` (cascade order; `bun run check` fails if a file is missing).
- New names are `SPOPI` / `spopi`. Comments explain a decision or a constraint. Log prefixes are `[spopi]` in the WebView, `[spopi-host]` in Rust, and `[spopi-bridge]` in extensions. Locale keys are `<domain>.<screen>.<name>`.
- `src-tauri/resources/skills/spopi-customize/ui-map.md` is generated by `scripts/build-ui-map.mjs`; do not edit it by hand.
- Rust areas are `host`, `pi`, `terminal`, `git`, `data`, `packages`, `platform`, `metrics`, `editor`, and `dependencies`.
- Host operations return `host::op_error::OpError` and succeed with `host_ok`. Do not add a new `Result<_, String>` or tuple error on a `/v2` op.
- Windows `\\?\` prefixes: one helper, `data::paths::strip_verbatim_prefix` (`platform::open` re-exports it).
- `open_external` accepts only `http:`, `https:`, and `mailto:`. On Windows it goes through ShellExecute, never `cmd /C start`.
- `setMessageActionDispatch` / `setFileActionDispatch` are the allowed leaf-widget exception. Do not add more page-level dispatch bags, and do not thread those two through every renderer unless a change already touches that stack.
- Reading a permission recipe never rewrites it. First run may seed Ask. Repair is `set_permission_mode` or Settings → Guard → Update.

## Architecture

SPOPI is a Tauri v2 app.

```
public/
  index.html  bootstrap.html  style.css  design-system.css  style-theme.css
  bootstrap-entry.js  *-vendor-entry.js  locales/  icons/  fonts/  vendor/
  app/
    app.js
    shell/  session/  chat/  composer/  editor/  files/  dock/  terminal/  git/
    metrics/  settings/  packages/  extension-ui/  pair/  perf/  subagents/
    transport/  storage/  notifications/  ui/  i18n/  theme/  utils/  test-utils/
src-tauri/src/
  main.rs
  host/  pi/  terminal/  git/  data/  packages/  platform/  metrics/  editor/
  dependencies/
extensions/
  spopi-bridge.ts  spopi-verify.ts  spopi-tool-output.ts  scratch-dir.ts
  bridge/<domain>.ts
  spopi-verify/  spopi-tool-output/
  testing/spopi-fake-provider.ts
```

**Rust** owns process lifecycle, the HTTP/WebSocket host, and window management. `pi/runtime.rs` supervises `pi --mode rpc`. `host/server/` owns `/v2/ws` and `/v2/bootstrap`. `pi/launch.rs` resolves the bundled binary and the bridge extension.

**Frontend** is vanilla JS. `bootstrap-entry.js` loads `app/app.js`, which builds gateways and calls `mountX`. Each domain folder owns its JS, CSS, and tests.

**Bridge** extensions compile to `extensions/dist/`. `spopi-bridge.ts` runs inside Pi. `bridge/` holds one handler module per `/spopi-config` domain. `custom-ui-bridge.ts` and `host-ui-capabilities.ts` live under `extensions/bridge/`.

## Key data flows

- User action → `app/transport/runtime-gateway.js` → `/v2/ws` → `HostServer` → `PiRuntime` → Pi stdio RPC.
- Extension UI requests → Pi stdio RPC event → `HostServer` → `app/extension-ui/extension-ui-host.js` → response over `/v2/ws`.
- Slash commands: `get_commands` → `app/composer/slash-commands.js` → `app/composer/composer-slash-menu.js` → `prompt` RPC.

## Bumping the embedded pi version

1. Read the Pi release notes since the pinned version.
2. `bun run bump:pi <version>`: pins the version and `SHA256SUMS` hashes in `scripts/pi-version.json` and the types devDependency, then fetches Pi, rebuilds the extensions, and regenerates the RPC contract and session fixtures.
3. Follow `docs/PI_BUMP.md` for the fixtures to recheck by hand, the smokes, and the checks.
4. Commit `scripts/pi-version.json`, `package.json`, `bun.lock`, and `tests/fixtures`. Do **not** commit `src-tauri/resources/pi/`; it is gitignored.

## Embedded pi: how it ends up inside the .app

End users never run `fetch:pi`. The flow that puts `pi` inside the shipped bundle is:

1. **Pre-build hook.** `package.json` `prebuild` runs `bun run fetch:pi` before `tauri build`. Downloads the platform tarball into `src-tauri/resources/pi/` (idempotent; skipped if `.version` matches). Bun honors npm-style `pre*` / `post*` lifecycle hooks for `bun run`.
2. **Tauri before-hooks.** `tauri.conf.json` `build.beforeBuildCommand` and `build.beforeDevCommand` BOTH run `bun run fetch:pi` first, so even invoking `tauri build` / `tauri dev` directly (no `bun run build`) still guarantees the binary is present.
3. **Tauri bundling.** `tauri.conf.json` `bundle.resources` maps `./resources/pi` → `pi`, so the entire pi runtime tree is copied into `<App>.app/Contents/Resources/pi/` at package time.
4. **Last-line guard (build.rs).** `src-tauri/build.rs` PANICS at compile time if `resources/pi/<bin>` is missing in a release profile. This prevents `cargo build --release` (or any IDE that bypasses bun) from silently producing a .app with no pi inside. Override only for local experiments via `SPOPI_SKIP_BIN_CHECK=1`.

Net effect: there is no path that ships a SPOPI release without the embedded pi binary. End users get a self-contained app — no PATH lookups, no `bun run fetch:pi`, no manual install of pi.

## Post-fix verification

After Rust edits, run `bun run check:rust`. Do not use `tauri build` or `cargo build` merely to verify a fix. After frontend or extension edits, run `bun run check` (focused test first, then the broader suite). `bun run test` includes Vitest and Tauri capability validation. Do not claim completion with failing tests or undocumented intentional warnings. For loopback access, filesystem paths, static assets, or locale coverage, run the full `bun run test` suite.

```bash
bun run vitest run public/app/settings/settings-save-status.test.js
```

SPOPI uses the Tauri v2 updater plugin to fetch new releases from GitHub. The build side is wired into `.github/workflows/release.yml` via the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets. See `docs/PI_BUMP.md` for the signing-key setup.

The embedded binary is the only Pi runtime SPOPI launches. To upgrade it, follow [Bumping the embedded pi version](#bumping-the-embedded-pi-version) and [`docs/PI_BUMP.md`](docs/PI_BUMP.md).
