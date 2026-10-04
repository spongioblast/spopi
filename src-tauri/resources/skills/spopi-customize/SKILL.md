---
name: spopi-customize
description: Change SPOPI's look, layout, or wording. Use when the user asks to customize the SPOPI GUI.
---

# Customize SPOPI

SPOPI is a desktop GUI around `pi --mode rpc`. One session store. Each region is a component with `mountX(root, deps)`.

If this workspace contains `src-tauri/tauri.conf.json` with identifier `app.spopi.desktop`, this is SPOPI development. Follow that repo's `AGENTS.md` and edit the source. Do not use the overlay.

## Pick the right layer first

New behaviour belongs to Pi, not to this overlay. A Pi extension or a skill is installed once, works in SPOPI and in the terminal, survives every SPOPI update, and needs no copy of a shipped file. Reach for the overlay only for the interface part: how something looks, where it sits, what it is called, or a control that has to live in the window.

An extension already gets a UI without any change here: its slash commands, its `select`/`confirm`/`input`/`editor` dialogs, ask-the-user cards, `setStatus` chips, `notify` notes, `setWidget` content by the composer, a `ctx.ui.custom` panel as a tab, and a row on the Packages page. Check whether the user's request is already covered before you write anything.

## Where to edit

Never write the shipped UI directory. The prompt names it. Read shipped files there with `read` or `grep`; `cp`, `sed`, `awk`, and the `ff*` search tools are blocked on that directory. Do not download them from the host. Edits go to the overlay directory, also named in the prompt. Scratch files go in the current project's `.pi/tmp/`.

1. Prefer `user.css` in the overlay for visual changes. It loads after every other stylesheet and reloads by itself.
2. Prefer `locales/<lang>.json` for wording. Put only the keys you change. Unknown keys are ignored.
3. For behaviour — a button, a panel, reacting to an extension — write `user.js` in the overlay. The page loads it as a module on every start, and it may import other files you add next to it. Wait for the app before touching the DOM:

```js
window.addEventListener("spopi:ready", () => {
  // document.querySelector(...) etc.
});
```

4. Only then call `spopi_ui_copy` with the file's path and edit the copy it makes. Do not retype a shipped file. The host snapshots the old shipped file under `.base/`, and every copy is one more file to merge after an update, so copy as few as the change needs. A new settings page needs one: the tab bodies are elements in `index.html`, so `user.js` alone cannot add one.

`index.html` cannot be overridden: the host builds it from the shipped copy on every start.

Find the file with `grep -n -i <word> ui-map.md` (the map beside this skill lists every UI file with one line each and is too long to read whole), then read that file's two ABOUTME lines. Map paths are relative to the shipped directory, and the overlay uses the same paths.

## Rules

Vanilla JS modules. No build step. No new page globals besides `window.spopi`. Keep files small. Components create their own DOM and talk through the store. Colors come from the tokens in `style-theme.css`, never hardcoded; a rule that differs between light and dark themes keys on `:root[data-scheme="light"]`, not on theme ids. The terminal and the Usage charts paint on a canvas and read tokens, not CSS rules: set `--bg-solid`, `--text-primary`, and optionally `--ansi-*` and `--chart-1` … `--chart-6` on `:root`, or the terminal keeps the old background. Settings → Terminal can force a fixed dark or light terminal regardless of the theme.

After a `user.css` change, the change appears without a reload. After any other overlay file, SPOPI shows a banner with a **Reload** button: ask the user to click it, then check with a screenshot. If the UI breaks, tell them to restart with `spopi.exe --safe`.

## Check your change

Call `spopi_screenshot` and look at the real window. Do not build a copy of the page: it loads a different cascade and shows colors the app does not have. If the prompt names a live-debugging port, use `agent-browser --cdp <port>` to click through the change (open a settings page, switch the theme), then take a screenshot. Never type into the chat composer. Without that port, ask the user to click, then take a screenshot.

## After an update

A stale override is not served. Three files sit side by side: `.base/<path>` (old shipped), the new shipped file, and the overlay copy. Merge into the overlay copy and save it; saving a stale file marks it merged and it is served again. To drop it instead, the user clicks Revert in Settings → Customizations.

## What you cannot change

The Rust host and `spopi-bridge` are not customizable. To replace another bundled extension (`pi-permission-system`, `spopi-verify`, `spopi-tool-output`), turn off "Load SPOPI's copy" under Bundled with SPOPI in Settings → Packages, then install the fork as a normal Pi package.
