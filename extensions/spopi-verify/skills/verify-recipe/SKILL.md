---
name: verify-recipe
description: Write or refresh this project's verify skill, a short recipe for installing, building, testing, running, and looking at the project, recorded from commands that worked here.
disable-model-invocation: true
---

# Write the project's verify recipe

Produce `.agents/skills/verify/SKILL.md`. The agent reads it when it needs to check its work in this project. Every command in it must be one you ran here and saw succeed.

If the file already exists, run its steps again and fix what changed. Do not start over.

## 1. Find the candidates

Read, do not guess: `README`, `package.json` scripts, `Cargo.toml`, `pyproject.toml`, `Makefile` or `justfile`, `.github/workflows/`, `AGENTS.md`, `CONTRIBUTING`, `docker-compose.yml`, `.env.example`. CI workflows are the best evidence of what the project really runs.

## 2. Run each step

In this order. For each one, note the exact command, the folder it runs in, how long it took, and what success looks like.

1. **Install.** Only when dependencies are missing. Use the lockfile form (`npm ci`, `bun install --frozen-lockfile`, `pnpm install --frozen-lockfile`, `uv sync`, `cargo fetch`). Ask the user before installing anything outside the project.
2. **Fast check.** Typecheck and lint. This is what runs after every change, so note whether it finishes in under a minute.
3. **Tests.** How to run one test file, then the full suite and how long it takes.
4. **Run.** Start the app in the background with its output in a log and its process id in a file: `mkdir -p .pi/tmp && (<start command> > .pi/tmp/run.log 2>&1 & echo $! > .pi/tmp/run.pid)`. Find the URL or port, confirm it answers (`curl -sf <url>`), then stop it with the stop line below and confirm the port is free. Never stop processes by name or command-line pattern.
5. **Look.** For a UI, follow the browser-check skill once: open the URL, take one screenshot, and note what the first screen should show and one thing worth clicking.

A step that fails goes under "Known problems" with the error line and the fix, if you found one. Do not change project code to make a step pass. Tell the user what is broken.

Commands must work in the shell your `bash` tool uses. On Windows that is often Git Bash, not PowerShell. There, `kill` on a process started through `npm run` leaves its child running; the stop line in the template stops the whole tree.

## 3. Write the skill

Keep it under about 60 lines. Write only what an agent cannot see at a glance from the files. Leave out architecture and style rules.

```markdown
---
name: verify
description: How to build, run, test, and look at <project>. Read before checking your work here.
---

# Verify <project>

## Setup
- `<install command>` when `<folder>` is missing.

## Fast check (after every change)
- `<command>` (about <N> s)

## Tests
- One file: `<command> <path>`
- All: `<command>` (about <N> min)

## Run
- `mkdir -p .pi/tmp && (<start command> > .pi/tmp/run.log 2>&1 & echo $! > .pi/tmp/run.pid)` serves <URL>. Ready when <log line or curl check>.
- Stop: `pid=$(cat .pi/tmp/run.pid); if [ -e "/proc/$pid/winpid" ]; then taskkill //PID "$(cat /proc/$pid/winpid)" //T //F; else kill "$pid"; fi`

## Look (UI only)
- Open <URL> with the browser-check skill. The first screen shows <what>. Try <one interaction>.

## Known problems
- <symptom>: <fix>
```

## 4. Point the verify gate at the fast check

SPOPI's verify gate runs a check at the end of every run that edited files. Without a config it picks a `typecheck`, `type-check`, `check:types`, or `check` script, then `tsc --noEmit`, `cargo check`, or `go vet`. If that is not the fast check you recorded, write `.pi/verify.json`:

```json
{ "command": "<fast check>" }
```

## 5. Report

Tell the user what you recorded, what failed, and anything they should confirm. Do not add the recipe to `AGENTS.md`; Pi lists project skills by itself. Suggest committing `.agents/skills/verify/SKILL.md` and `.pi/verify.json`.
