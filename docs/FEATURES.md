# SPOPI features

What SPOPI does, from the user's side: how to reach each feature, how to configure or turn it off, what it does not do, and which Pi piece it relies on.

This is the feature reference. `ARCHITECTURE.md` holds the rules the code must keep (transport, security boundary, ownership, invariants) and points here for behavior. `README.md` is the short pitch. When a change alters what a user sees or can configure, update the matching section here in the same change.

Every feature section has the same parts:

- **Use:** where it is in the UI, shortcut, or command.
- **Configure:** settings, files, fields, defaults, and how to turn it off.
- **Limits:** what it does not do.
- **Pi:** the Pi command, RPC call, event, or package it relies on. SPOPI never re-implements Pi.
- **Code:** the main files, for changes.

Shortcuts use `Mod` for Ctrl on Windows and Linux, Cmd on macOS.

## Contents

- [Where things are stored](#where-things-are-stored)
- Editing: [Editor](#editor) · [Inline edit](#inline-edit) · [Review and undo](#review-and-undo) · [Git panel](#git-panel) · [Worktrees](#worktrees) · [Search and preview](#search-and-preview) · [Dock: terminal, problems, cockpit](#dock-terminal-problems-cockpit) · [Projects](#projects)
- Sessions: [Chat transcript](#chat-transcript) · [Composer](#composer) · [Queue while Pi works](#queue-while-pi-works) · [Session tree, fork, compact](#session-tree-fork-compact) · [Session list, titles, export](#session-list-titles-export) · [Models and providers](#models-and-providers) · [Subagents](#subagents) · [Notifications](#notifications) · [Extension UI](#extension-ui)
- Checks and safety: [Permission modes](#permission-modes) · [Project trust](#project-trust) · [Verify gate](#verify-gate) · [Verify recipe and browser check](#verify-recipe-and-browser-check) · [Long tool output](#long-tool-output)
- Packages: [Packages page](#packages-page) · [Bundled extensions](#bundled-extensions) · [Recommended packages](#recommended-packages)
- Tools: [Dependencies](#dependencies) · [Browser for Pi](#browser-for-pi)
- Customizing SPOPI: [UI overlay and safe mode](#ui-overlay-and-safe-mode) · [Pi looks at SPOPI](#pi-looks-at-spopi)
- Other: [Settings pages](#settings-pages) · [Phone access](#phone-access) · [Keyboard shortcuts](#keyboard-shortcuts) · [Updates, app data, and environment](#updates-app-data-and-environment)
- [Not in SPOPI](#not-in-spopi)

## Where things are stored

| What | Where |
|---|---|
| Pi settings, models, auth, packages, sessions | `~/.pi/agent/` (shared with the Pi terminal), or `$PI_CODING_AGENT_DIR` |
| Session transcripts | For a project SPOPI created, `<project>/.pi/sessions/*.jsonl`. A folder you opened keeps Pi's default `~/.pi/agent/sessions/<project>/*.jsonl` until **Keep chats in project folder**. |
| SPOPI app state (layout, `ui.*` preferences) | Windows `%APPDATA%\spopi\spopi.sqlite3`, macOS `~/Library/Application Support/spopi/spopi.sqlite3`, Linux `~/.config/spopi/spopi.sqlite3`, or `$SPOPI_APP_DATA_DIR` |
| UI overlay (customizations) | `<app data>/ui/` |
| Permission recipes | `~/.pi/agent/extensions/pi-permission-system/config.json` |
| Project check for the verify gate | `<project>/.pi/verify.json` |
| Saved long tool output, large pastes | `<project>/.pi/tmp/` (ignored by Git) |
| WebView cache and SPOPI's log | The Tauri app-data folder for `app.spopi.desktop`: Windows `%LOCALAPPDATA%\app.spopi.desktop\`, macOS `~/Library/Application Support/app.spopi.desktop\`, Linux `~/.local/share/app.spopi.desktop\` |

## Editor

Open a file and it fills the center, in tabs.

- **Use:** click a file in the Files sidebar. The **Save file** control writes it. **Auto-save** is off by default.
- **Selection bar:** selecting text shows **Edit** ([inline edit](#inline-edit), `Mod+K`) and **Ask Pi** (`Mod+L`) under the selection. It hides while the inline edit prompt is open. **Ask Pi** adds an `@file:lines` mention such as `@src/todo.js:1-9` to the composer, and the cursor waits after it for the question. Pi reads those lines from the file, so unsaved edits are not included. The mention is a pill like any `@` mention: click it to open the file at that line, or remove it with its ×.
- **Configure:** `ui.editor.autoSaveOptIn` (Auto-save).
- **Limits:** text editing is capped at 1 MiB per file. If the file changed on disk since it was opened, saving offers **Reload** or **Overwrite** instead of writing over it.
- **Code:** `public/app/editor/file-preview-panel.js`, `code-editor.js`, `selection-actions.js`, `src-tauri/src/host/server/http/files.rs`.

## Inline edit

Select code, describe the change, and Pi rewrites the selection.

- **Use:** select text in the editor and click **Edit** in the small bar that appears under the selection, or press `Mod+K` (with no selection, `Mod+K` takes the cursor's line). Type the instruction and press Enter. The button reads **Editing…** while the model works. The answer replaces the selection as one change, is selected so you can see it, and the file is saved the way `Mod+S` saves it. There is no accept step: `Mod+Z` undoes it, and the Git panel shows it and can discard it like any other change. Escape or **Cancel** closes the prompt. It does not go through the chat, so it is not in Review or Pi's `/undo`.
- **Limits:** acts on the selection only. The selection's own blank lines and indentation are kept, so the model dropping a trailing newline does not delete a line. If the model gives the selection back unchanged, the prompt says so and stays open. If the selected text changed while the model was working, nothing is applied and the prompt says so. Outside the editor, `Mod+K` opens session search instead.
- **Pi:** the bridge's `inline_edit` operation calls the current model.
- **Code:** `public/app/editor/inline-edit.js`, `inline-edit-host.js`, `merge-view.js`, `extensions/bridge/model-calls.ts`.

## Review and undo

Review is the record of what Pi changed, one file at a time.

- **Use:** **Review** on the rail, or **Review** on a turn's "Changed N files" line. Scopes: **Turn** and **Session**, plus Git diffs and commits from the Git panel. Keys while Review is open: `n` / `p` next and previous file, `j` / `k` next and previous hunk, `c` comment, `Escape` close.
- **Undo:** **Undo last turn** runs Pi's `/undo`, and **Redo** runs `/redo`. Undo covers the newest turn only, so it is offered while that turn or the whole session is shown.
- **Limits:** Turn and Session scopes and undo need the recommended `pi-workspace-history` package; it records each turn's before and after state (`turn-snapshots.json`). Files Pi changed in SPOPI's own UI overlay are marked SPOPI UI and are not covered by undo; revert them in Settings → Customizations.
- **Pi:** `pi-workspace-history` (`/undo`, `/redo`, snapshots).
- **Code:** `public/app/editor/review-pane.js`, `public/app/review/`, `src-tauri/src/data/shadow_history.rs`.

## Git panel

The repository: stage, discard, commit, and browse history.

- **Use:** **Git** on the rail, or **Toggle Git changes** in the chat header. Groups: Staged, Changes, Untracked, Conflicted. Actions: **Stage**, **Unstage**, **Discard changes**, **Commit**, **Generate AI commit message**, fetch, pull, push, **History**. A folder that is not a repository offers **Initialize repository**. Diffs open in the same diff tab as Review.
- **Code:** `public/app/git/`, `src-tauri/src/git/`.

## Worktrees

One session per Git worktree.

- **Use:** **New worktree task** on the home view puts `/worktree create ` in the composer. `/worktree` appears in the slash menu.
- **Limits:** needs the recommended `@pify/worktree` package. SPOPI does not create worktrees itself.
- **Pi:** `@pify/worktree`.
- **Code:** `public/app/editor/center-paint.js`, `public/app/composer/slash-sources.js`.

## Search and preview

- **Use:** **Search files** in the Files sidebar, `Mod+P` to focus it. File context menu: **Run in terminal**, **Reveal in Explorer**, **Open in desktop**.
- **Preview:** text, markdown, and HTML (editable), images, PDF, and Office-type files through MarkItDown (`docx`, `pptx`, `xlsx`, and similar).
- **Limits:** search uses ripgrep when installed, otherwise a directory walk; at most 200 hits. MarkItDown preview needs Python 3.10 or newer with MarkItDown installed.
- **Code:** `public/app/files/file-search.js`, `public/app/editor/file-preview-*.js`, `src-tauri/src/data/workspace_search.rs`, `src-tauri/src/editor/markitdown.rs`.

## Dock: terminal, problems, cockpit

The dock sits under the editor. `Mod+J` toggles it.

- **Terminal:** profiles Git Bash, PowerShell, CMD, or Default. **Run in terminal** sends a language-specific run command for a file. Configure in Settings → Terminal (`ui.terminalDefaultProfile`, theme, font, scrollback, WebGL).
- **Problems:** diagnostics from the recommended `pi-lens` package, grouped by file. Empty without `pi-lens`.
- **Cockpit:** for every model, what Pi reports per prompt: output and prompt tokens, tokens per second, cache hits, and wall time. When the model server is local (loopback or LAN) and answers `/metrics` with vLLM's counters, it adds KV cache, TPOT, TTFT, queue, prefill, and accept length; LM Studio, Ollama, and cloud APIs show only Pi's numbers. A metrics URL you set yourself replaces `<server>/metrics`. The thinking-budget button appears for a model that has Pi's `compat.thinkingTokenBudgetField`, whatever the provider is called. The **Prompts & tools** log has one row per prompt: output tokens summed over all its model calls, the latest call's prompt size, and "N calls" when Pi made more than one request (the tooltip lists each call's output). Under it are the prompt's newest 40 tool calls, with a row counting any earlier ones. Also the **Cache warming** control (Off, Streaming, Idle; writes Pi's `cacheWarming`, default Streaming). `/cockpit` opens it.
- **Code:** `public/app/dock/`, `public/app/metrics/`, `public/app/terminal/`.

## Projects

A project is the folder Pi runs in.

- **New project:** the **+** at the top of the sidebar (`Mod+Shift+N`) creates a folder named `2026-09-29_07-30-05` in the Projects folder and opens a chat in it. The new project heads the list as the open project before its first message is saved. The **+** on a project row (`Mod+N`) starts another chat in that project.
- **What a new project contains:** `.pi/settings.json` with Pi's `sessionDir` set to `.pi/sessions`, so the chats live in the folder, and a `.gitignore` that ignores every dot folder. SPOPI treats the project as trusted, so it does not ask. An empty dated project you leave is deleted: when the window opens another project, or at the next start. A dated folder with a saved chat or any file of yours is kept, and so is a folder that is a link or junction. A second SPOPI started while one is running skips the start-up cleanup.
- **Open folder:** the project comes back if you had closed it, and its chats load. If those chats were recorded at another path, the project offers **Link them here**.
- **Keep chats in project folder:** on a folder you opened, the project menu stops the project's Pi process, moves its chats (with their subagent chats) into `.pi/sessions`, and sets `sessionDir` without touching other settings. Only `.pi/sessions` is ignored by git, and an existing `.gitignore` is left as it is. The Pi terminal asks to trust the folder once.
- **Rename:** the project menu renames the folder too. SPOPI stops the project's Pi process and terminals first, then points every chat and subagent chat at the new folder, keeps the project's pins, and runs `git worktree repair` for a repo with worktrees. A folder outside the Projects folder asks first, and so does a reply that is still running. If another program holds the folder, nothing changes and the chat resumes where it was.
- **Close project:** stops the project's Pi process and terminals, and the project leaves the sidebar. Chats stay on disk. Open the folder again to bring the project and its chats back. SPOPI does not start in a closed project.
- **Configure:** Settings → General → **Projects folder** (`ui.projectsFolder`; empty means `SPOPI` in your home folder). If that folder cannot be used at start, SPOPI uses `SPOPI` in your home folder and shows a note once.
- **Moved or deleted folder:** the project shows a card with **Close project** and **Locate folder…**. Locate asks for the folder's new place, moves the chats Pi kept for the old path, points them at the new one, and opens the project there.
- **Limits:**
  - `pi --resume` in the terminal lists every project only from Pi's own session folder, so chats kept inside a project show there when `pi` runs in that folder.
  - A git worktree has no `.pi/settings.json`, so its chats go to Pi's default folder.
  - After a rename, the Pi terminal asks to trust the folder again; SPOPI itself does not ask.
  - A rename drops history that a package keeps by folder path.
- **Code:** `public/app/session/workspace-actions.js`, `session-sidebar.js`, `missing-workspace.js`, `projects-folder-fallback.js`, `public/app/settings/projects-folder-setting.js`, `src-tauri/src/data/projects_folder.rs`, `session_dirs.rs`, `session_relocate.rs`, `src-tauri/src/host/server/ops/projects.rs`.

## Chat transcript

Pi's chat runs the full height of the window.

- Each prompt is one quiet turn. Thinking and tool calls fold into one row ("Worked for …" with counts of files read, commands run, and files edited); the final answer stays visible. A turn that changed files ends with "Changed N files · Review".
- A metrics line per turn: model, duration, input and output tokens, cache hits.
- **Configure:** Settings → General → **Show thinking** (default on). The switch writes Pi's `hideThinkingBlock` (inverted) in the shared agent folder, so the Pi terminal follows it. Off hides thinking in the transcript; a finished work row that held only thinking is hidden too, while a running one stays so the turn still shows progress.
- **Code:** `public/app/chat/turn-block.js`, `transcript-turns.js`, `history-render.js`, `public/app/ui/tool-card.js`.

## Composer

- **Slash menu:** type `/`, or press `/` outside a text field. It lists Pi's commands (`get_commands`) and SPOPI's (`/model`, `/thinking`, `/tree`, `/fork`, `/compact`, `/export`, `/review`, `/guard`, `/cockpit`, `/phone`, `/hotkeys`, `/tui`). A command whose UI only works in the Pi terminal is marked **Terminal-only**.
- **Files:** type `@` to mention a file. `@path:12` or `@path:12-30` names lines in it.
- **Images:** **Attach image** (png, jpeg, gif, webp; scaled to at most 2048 px).
- **Large paste:** a paste of 4 KiB or more offers **Attach as file** or **Keep inline**. Attaching writes the text to a file under `.pi/tmp/` in the project (ignored by Git) and attaches that file.
- **Model:** the model control, or `Mod+Alt+M` to cycle.
- **Thinking:** **Think** cycles through the levels the model supports (off, minimal, low, medium, high, and xhigh or max when the model maps them). The default for new sessions is in Settings → General; a model can have its own default in Settings → Models. A model without thinking shows a note instead.
- **Permission mode:** the chip cycles Ask, Auto-edit, Full access (`Mod+Shift+M`). See [Permission modes](#permission-modes).
- **Code:** `public/app/composer/`.

## Queue while Pi works

- **Use:** while a turn runs, Enter sends a steering message into the running turn and Alt+Enter queues a follow-up for after it. Queued messages show as pills with **Edit**, **Send now**, and cancel.
- **Configure:** Settings → General: **While Pi is working, new messages** and **Follow-up messages**, each **One at a time** or **All at once**. They write Pi's `steeringMode` and `followUpMode` (default one at a time).
- **Pi:** RPC `steer`, `follow_up`, `set_steering_mode`, `set_follow_up_mode`.
- **Code:** `public/app/composer/queued-messages.js`, `public/app/settings/queue-modes.js`, `extensions/bridge/queue-prefs.ts`.

## Session tree, fork, compact

- **Session tree:** in the info sidebar and as a center tab (`/tree`). Navigate to any entry, **Edit from here**, **Summarize**, or **Try again with another model**. Entries can get a label.
- **Fork and edit:** on a user message, **Fork session** or **Edit message**. **Duplicate session** in the sidebar clones it.
- **Retry:** a failed request shows a retry banner with **Abort**. Auto-retry is on by default (Settings → General).
- **Compact:** **Compact** in the header summarizes older context; it is offered from about 20,000 context tokens. Auto-compaction is on by default (Settings → General). The header shows context usage.
- **Pi:** RPC `fork`, `clone`, `compact`, bridge `navigate_tree` and `set_label`.
- **Code:** `public/app/session/session-tree-tab.js`, `info-panel.js`, `message-fork.js`, `context-usage.js`, `public/app/chat/retry-banner.js`.

## Session list, titles, export

- **Sidebar:** sessions grouped by project, with Pinned and Projects. Each project ends with a collapsed **Archived (n)** row. Session menu: **Rename**, **Generate title**, **Pin session** (up to 20), **Archive**, delete, **Duplicate session**, **Export as HTML**. Project menu: **Rename**, **Close project**, **Keep chats in project folder**.
- **Titles:** set automatically after the first turn.
- **Search:** the sidebar search box, or `Mod+K` outside the editor for a search dialog.
- **Pi:** RPC `export_html`, bridge `generate_session_title`, Pi's session files.
- **Code:** `public/app/session/session-sidebar.js`, `session-menu.js`, `session-export.js`, `session-search-dialog.js`, `extensions/session-title-auto.ts`.

## Models and providers

Use a cloud model or a local one (vLLM, Ollama, LM Studio, or any OpenAI-compatible endpoint), and switch inside a session.

- **Use:** Settings → Models: API keys (stored in Pi's `auth.json`), a provider and model editor over `models.json`, **Add custom provider**, and **Sign in with ChatGPT**. Changes apply without a restart.
- **Add custom provider:** enter the base URL. On leaving the field, or on **Save** with protocol **Auto**, SPOPI detects the server. It tries OpenAI-compatible first and Anthropic only when that fails, and takes the context window from the model list when the server reports it (vLLM's `max_model_len`, `context_length`, and similar). It also suggests an id from the server (`vllm`, `ollama`, or `local-<port>`). The key is optional: a keyless local server saves with `apiKey: "none"`. Each listed model shows its context or, when the server does not report one (LM Studio, Ollama, llama.cpp), a field for the size your model runs with; left empty, Pi's default of 128,000 is used. Each model also gets a **Thinking** switch. After saving, the provider view offers **Set up model** for the models you picked; SPOPI does not probe every model.
- **Set up model:** on a model row or in the model form. It sends a few short requests to that one model and fills the form: context window, whether it reasons, how thinking is switched (`reasoning_effort`, Qwen chat template, or chat template kwargs), whether it accepts images, and whether a thinking budget works. For `reasoning_effort` it asks which levels the server accepts (vLLM lists them when it rejects an unknown one, otherwise each level is tried) and whether `none` turns thinking off. When the effort can switch thinking, it wins over the chat template, and the model gets a `thinkingLevelMap` with only those levels, so the Think button offers nothing the server would reject with a 400. A check that cannot be decided is shown as **–** and leaves the field alone. Nothing is written until **Save model**; saving re-selects the model in the open session, since Pi keeps the old definition until then.
- **Provider view:** base URL and protocol are a draft, saved with **Save provider**. **Rename** changes the provider id and moves its stored key, its thinking levels, its hidden and health entries, and matching `enabledModels` and `defaultProvider` in `settings.json`. **Delete provider** asks first and removes that entry from `models.json`; a keyless custom provider (LM Studio, Ollama, vLLM) does not stay in the list as a leftover catalog card. Cloud providers with a key in `auth.json` still appear.
- **Model picker switches:** each model row in the provider view has a switch that puts the model in the composer's model picker. The Models header shows how many are on, an **All models** switch, and **Check health**; a checked model gets a green or red dot. A model you list in `models.json` starts on, and a built-in cloud model starts off until you switch it on. A model Pi has not loaded (no key yet, or the server did not answer) cannot be switched on. The switches are stored in `spopi-models.json` in Pi's agent folder. With every model off the composer's model button reads **No model**; when the selected model was switched off or removed it reads **Choose a model**. In both cases Send is dimmed and a message is not sent: it stays in the box, and a note points to the model menu (or to Settings → Models when no model is on). Slash commands such as `/login` still run.
- **Key row:** shows where the key comes from (`auth.json`, an environment variable, a command, a literal in `models.json`, or none). It never shows the key itself. A keyless provider says **Not needed: this server runs without a key**, and its button is **Add key (optional)**. **Test connection** asks the server for its model list with the current key, or with none. It reports the model count and time, says when the server asks for a key (HTTP 401 or 403), or shows the error. A model list does not load a model, so the test is cheap on LM Studio and Ollama. **Replace** stores a new key in `auth.json`, or writes a `$NAME` or `!command` reference into `models.json`. **Move to auth.json** takes a literal key out of `models.json`. **Remove** asks first and leaves the provider keyless.
- **Model form:** **Edit** opens a form with a breadcrumb back to the provider. It covers id, name, context window, max tokens, **Thinking** (control and default level, plus an optional thinking budget), and **Accepts images** (with resize limits). **Save model** writes `models.json` and the default level, then returns to the provider view with the saved row highlighted. **Cancel**, the breadcrumb, another list item, or closing Settings with unsaved edits asks before discarding them.
- **The composer shows Pi's model:** after a session opens, the model button and **Think** show what Pi reports (`get_state`), not what SPOPI remembers. An empty session first switches Pi to the model you picked last. If Pi does not list that model yet, SPOPI asks Pi to reload its model list and tries once more; if it still fails, a note shows Pi's error. When Pi runs no model, the button reads **Choose a model**, Send is held back, and **Think** opens the model picker.
- **Open session:** when a save touches the provider of the session's model, SPOPI selects the model again, so thinking and images apply without a new session. It also applies the saved default level. While Pi is replying, this waits until the reply ends. If the model has no thinking levels, **Think** says so and links to its settings.
- **Local models on the home view:** with no file open, the center lists **Local models** that answer on their default port: vLLM (`8000`), Ollama (`11434`), and LM Studio (`1234`). It checks again every 30 seconds while the home view is shown.
- **Configure:** Advanced JSON opens the whole `models.json` in a dialog. The default thinking level per model is stored in `settings.json` (`modelThinkingLevels`).
- **Limits:** Pi's own key order applies: a key in `auth.json` wins over `apiKey` in `models.json`. Set up model needs the server to answer chat requests; a slow model can take up to about two minutes. The home view's local model list only sees servers that allow the app's origin: vLLM and Ollama do by default, LM Studio only with its CORS option on. A server on another port is not listed.
- **Pi:** Pi's model registry, `models.json` (`reasoning`, `thinkingLevelMap`, `compat.thinkingFormat`, `input`, `inputLimits`), `auth.json`, RPC `set_model` and `set_thinking_level`.
- **Code:** `public/app/settings/models-page.js`, `public/app/settings/models/` (`provider-editor.js`, `model-form.js`, `model-draft.js`, `model-setup-panel.js`, `provider-key-row.js`), `settings-custom-provider.js`, `models-oauth-login.js`, `public/app/composer/model-config-refresh.js`, `public/app/composer/composer-pi-sync.js`, `extensions/custom-provider-probe.ts`, `extensions/provider-model-setup.ts`, `extensions/bridge/providers.ts`, `extensions/bridge/provider-keys.ts`.

## Subagents

- **Use:** while children run, a **Subagents** strip sits above the composer. **Open** shows one child's conversation as a tab, with a message field, **Steer**, and **Stop**.
- **Limits:** needs the recommended `pi-subagents` package.
- **Pi:** `pi-subagents` widgets over RPC.
- **Code:** `public/app/subagents/`.

## Notifications

- **Use:** when a turn finishes while the window is not focused, SPOPI shows a system notification; clicking it opens that session.
- **Configure:** Settings → General → **Task completion notifications** (`ui.settings.task-notifications`, default on).
- **Code:** `public/app/notifications/task-completion-notifications.js`, `src-tauri/src/commands.rs`.

## Extension UI

Pi extensions can ask the user things; SPOPI draws them. Installing an extension needs no customization: everything below appears on its own, and its slash commands join the slash menu, its tool calls render as tool cards, and it gets a row on the [Packages page](#packages-page) with its skills and prompts.

- Dialogs (`select`, `confirm`, `input`, `editor`) open in the app. Permission prompts dock on the approval bar in place of the composer (**Allow once**, **Always**, **Deny**).
- Ask-the-user questions (such as `rpiv-ask-user-question`) show as a card in the chat. Once answered, the card stays where it was asked: the work before it stays in the row above, and what Pi does next goes in a new row below. A question or dialog that is still open comes back after a window reload, once.
- Custom extension panels (`ctx.ui.custom`) open as a tab.
- Extension statuses (`ctx.ui.setStatus`) show in the status footer.
- Extension notifications (`ctx.ui.notify`) show as notes.
- Widgets (`ctx.ui.setWidget`) render around the composer.
- A message an extension appends with `display: true` (such as the verify gate's repair request) shows as a system note in the chat.
- **Pi:** RPC extension UI requests.
- **Code:** `public/app/extension-ui/`, `public/app/chat/custom-message-note.js`, `public/app/shell/status-footer.js`.

## Permission modes

Three recipes for the bundled `pi-permission-system` extension.

| Mode | Behavior |
|---|---|
| Ask (default) | Asks before every tool call |
| Auto-edit | Reads and edits without asking; asks before shell commands and paths outside the project. Looking at and clicking a local page with `agent-browser` does not ask |
| Full access | Runs commands and edits files without asking; says so once |

- **Use:** the composer chip, `Mod+Shift+M`, or Settings → General → **Mode**; all three set the same mode. `/guard` also opens it.
- **One mode, not per session:** the extension reads one recipe from Pi's agent folder, so the mode applies to every open and new session and to Pi in a terminal on the same folder. A new install starts in Ask.
- **Always denied, in every mode:** writes under Pi's agent `extensions/` folder, SPOPI's install folder, the shipped UI folder, and, on Windows installs whose path has a space, the copy of the bundled extensions Pi runs from (`%TEMP%\spopi-ext\<version>\`). Reading them follows the mode, so Pi can read the shipped UI to customize it and the skills in the install folder. On first start SPOPI writes the Ask recipe with these denies (`path_write`); a recipe whose denies are missing or stale, or one from an earlier build that also denied reads, is rewritten when SPOPI starts.
- **Skill files:** reading a skill's own files never asks at the skill step; the path, outside-folder, and tool rules of the mode still decide, so Ask still asks. The permission extension fixes the skill answer when a message starts and cannot grant it for the session, so an ask there would repeat on every read and outlive a switch to Full access. A recipe from an earlier build without this rule is rewritten when SPOPI starts.
- **Mode switch during a run:** the new recipe applies to the next tool call. A prompt already on screen keeps waiting for its answer.
- **Browser in Auto-edit:** `agent-browser` snapshot, screenshot, click, fill, type, press, wait, get, and similar page commands run without asking, and so does `open` on `http://127.0.0.1` or `http://localhost`. Opening any other address, `eval`, `upload`, `read`, cookies, and the flags that attach to or reuse a real browser (`--profile`, `--cdp`, `--auto-connect`, `--state`, and others) still ask. So does writing a project `agent-browser.json`, which can set those options.
- **SPOPI window in Auto-edit:** `spopi_screenshot` and `spopi_ui_copy` run without asking. With [live debugging](#pi-looks-at-spopi) on, the same page commands with `--cdp <SPOPI's port>` also run without asking; `open`, `back`, `forward`, other ports, and the flags above still ask. SPOPI refreshes the Auto-edit recipe at startup when the port changed.
- **Limits:** this is not a sandbox. Pi runs with your user's permissions. For isolation, run Pi in a container or VM; the **How to run Pi in a container** popover in Settings → General lists options.
- **Pi:** `@gotgenes/pi-permission-system`.
- **Code:** `extensions/bridge/permission-recipes.ts`, `public/app/composer/guard-chip.js`, `approval-bar.js`, `public/app/settings/guard-settings.js`.

## Project trust

When a project has its own Pi resources, SPOPI asks before Pi loads them.

- **Use:** **Trust once**, **Trust and remember**, **Open untrusted**, or **Cancel workspace opening**. A folder opened through the folder picker counts as trusted.
- **Trust enables:** the project's `.pi/` extensions, skills, and prompts, and the [verify gate](#verify-gate), which runs the project's own check command.
- **Pi:** Pi's project trust (`project_trust` event, `trust.json`).
- **Code:** `extensions/bridge/project-trust.ts`.

## Verify gate

After a turn that edits files, SPOPI runs the project's check before Pi stops. A failure in a file the turn changed goes back to Pi.

- **Use:** automatic. `/verify` runs the same check on demand and reports the result to you only.
- **What runs:** `.pi/verify.json` in the project, or a detected check: a `typecheck`, `type-check`, `check:types`, or `check` script in `package.json` (run with the package manager the lockfile names), `tsc --noEmit` when there is a `tsconfig.json` and a local `tsc`, `cargo check`, or `go vet`. Detection never installs anything.
- **Configure** (`.pi/verify.json`):

  ```json
  { "command": "bun run check", "timeoutSeconds": 300, "maxRepairs": 2 }
  ```

  `timeoutSeconds` 10–1800 (default 300), `maxRepairs` 0–5 (default 2). `{ "enabled": false }` turns it off for the project. To turn it off everywhere, switch off `spopi-verify` under Bundled with SPOPI on the Packages page.
- **What Pi sees:** the output lines that name a file it changed, at most 40, and the path of the full log (`<OS temp folder>/spopi-verify/<session id>.log`). After the check has passed once in a session, any later failure is sent as the output's last lines.
- **What you see:** the check's status in the status footer, the repair request as a system note in the chat, and a notification when the check fails outside the changed files, times out, or still fails after the repairs.
- **Limits:** runs only in trusted projects. Notices edits made with Pi's `write` and `edit` tools, or package tools named like them; files changed only through shell commands do not trigger it. Asks for at most `maxRepairs` repairs per turn, and does not ask again if Pi answers without editing. Needs a check command that works in the project.
- **Pi:** the `agent_before_settle` event and Pi's local shell executor. Also loads in the Pi terminal with `pi -e extensions/spopi-verify.ts`.
- **Code:** `extensions/spopi-verify.ts`, `extensions/spopi-verify/`.

## Verify recipe and browser check

Two skills ship with `spopi-verify`, so Pi can check its work the way a person would: build it, run it, and look at it.

- **Verify recipe:** `/skill:verify-recipe` has Pi read the project, run each install, check, test, and launch step, and write the ones that worked to `.agents/skills/verify/SKILL.md`. It also points the verify gate at the fast check. Pi then lists that project skill by itself and reads it when it needs to check its work. The generator never loads on its own.
- **Browser check:** the `browser-check` skill teaches the [agent-browser](https://github.com/vercel-labs/agent-browser) CLI: open a local URL, list clickable elements, click and type, take a screenshot to `.pi/tmp/screens/`, and read it back as an image. It covers webview desktop apps through a remote debugging port.
- **Configure:** agent-browser ships inside SPOPI. Chrome does not. Settings → Dependencies shows whether a Chrome was found; **Download browser** runs `agent-browser install` (Chrome for Testing, into `~/.agent-browser/`). On Linux, if it still does not start, run `agent-browser install --with-deps` (that step needs sudo, which SPOPI does not run). The browser-check skill is listed only when the development browser is on and `agent-browser` is on PATH. Cap screenshot cost per model with `inputLimits.images.resize` in `~/.pi/agent/models.json`.
- **Limits:** needs a model that takes images. The browser is agent-browser's own headless Chrome, not your browser or its logins. Native (non-web) GUIs are not covered.
- **Pi:** skills through `resources_discover`; `tool_call` creates `.pi/tmp/screens/` and starts the browser session with no pipe attached, because a first `agent-browser` command whose output is piped never returns.
- **Code:** `extensions/spopi-verify/verify-skills.ts`, `extensions/spopi-verify/skills/`.

## Long tool output

A long tool result is saved to a file, and Pi keeps only a short digest in context.

- **Use:** automatic. The tool card for a saved result shows a line that links the file.
- **Trigger:** a text result over 16 KB (about 4,000 tokens), or any result Pi's shell tool already truncated (2,000 lines or 50 KB). `read` results and results with images are left alone.
- **File:** `.pi/tmp/tool-output/<tool>-<time>-<call>.log` in the project. `.pi/tmp/` ignores itself in Git. Files older than 7 days are removed when a session starts.
- **What Pi keeps:** the size, the file path, the first 20 lines (up to 1 KB), and the last 60 lines (up to 4 KB), each line cut at 500 characters. The transcript, exports, and the tool card keep the full result.
- **Configure:** switch off `spopi-tool-output` under Bundled with SPOPI on the Packages page.
- **Limits:** if the project folder is not writable, results pass through unchanged.
- **Pi:** `tool_result` and `turn_end` with an appended context edit. Also loads in the Pi terminal with `pi -e extensions/spopi-tool-output.ts`.
- **Code:** `extensions/spopi-tool-output.ts`, `extensions/spopi-tool-output/`, `public/app/ui/tool-card.js`.

## Packages page

Settings → Packages manages Pi packages, the same ones the Pi terminal uses.

- **Installed:** enable, disable, update, and remove. A package that fails to load is marked **Failed to load**; that is the only case that suggests updating Pi.
- **Recommended:** the packages below, with what each adds.
- **Browse:** search and install from the Pi package registry.
- **Resources:** skills, prompts, and other resources. **Add skills** picks a folder; Pi scans it and appends the selection to `settings.json`. `SKILL.md` frontmatter is read with Pi's parser, so a file saved with a byte order mark or CRLF works as it does in Pi. A folder with no usable skill says **No skills found**, and files Pi would skip are listed with the reason (for example `hello/SKILL.md: description is required`). When Pi is idle it reloads and new `/skill:name` commands show up. When Pi is busy, the change waits for a new session or a restart. Turning a package or a resource off uses the same reload.
- **Bundled with SPOPI:** see below.
- **Code:** `public/app/packages/`, `src-tauri/src/packages/`, `extensions/bridge/package-health.ts`.

## Bundled extensions

Shipped inside SPOPI and passed to Pi at launch.

| Extension | What it does | Can be switched off |
|---|---|---|
| `spopi-bridge` | SPOPI's side of the connection: settings operations, extension UI, project trust prompt, session titles, the `spopi-customize` skill, the `spopi_screenshot` and `spopi_ui_copy` tools | No |
| `pi-permission-system` | [Permission modes](#permission-modes) | Yes |
| `spopi-verify` | [Verify gate](#verify-gate), and the [verify-recipe and browser-check skills](#verify-recipe-and-browser-check) | Yes |
| `spopi-tool-output` | [Long tool output](#long-tool-output) | Yes |

**Load SPOPI's copy**, under Bundled with SPOPI on the Packages page, turns SPOPI's copy off or on. The state line says whether SPOPI's copy, your own install, both, or neither load; both at once shows a warning. Changes apply when Pi restarts. To use a fork of a bundled extension, turn off SPOPI's copy and install the fork as a normal Pi package.

## Recommended packages

Not bundled. They need npm, which Settings → Dependencies tests. Install them from Settings → Packages → Recommended, or with `pi install npm:<name>`; the Pi terminal gets them too. Surf is optional and is set up from Dependencies, not from this list.

| Package | What SPOPI does with it |
|---|---|
| `pi-workspace-history` | Review Turn and Session scopes, `/undo` and `/redo` |
| `pi-lens` | The Problems tab; checks on every edit |
| `pi-subagents` | The Subagents strip and child tabs |
| `pi-context-view` | Walk the actual prompt Pi sends |
| `@ff-labs/pi-fff` | Fuzzy file search for Pi (the GUI's own search is ripgrep) |
| `@pify/worktree` | New worktree task and `/worktree` |
| `pi-web-access` | Lets Pi fetch web pages you point it at |

## Dependencies

Settings → Dependencies tests what SPOPI and Pi need on this computer. The status is read again every time. Nothing is remembered as installed.

Three kinds:

- **Built in.** Pi and agent-browser are fetched when SPOPI is built (`scripts/pi-version.json`, `scripts/agent-browser-version.json`) and shipped in the installer. The page shows the version. If one is missing or the wrong version, the row says to run the SPOPI installer again. That keeps settings, chats, and `~/.pi/agent`. SPOPI does not download them again from inside the app.
- **On demand.** Chrome for Testing, Node.js (which provides npm), and Surf. Each starts only after a click, one job at a time, with the output, **Cancel**, and on failure **Retry** and **Copy log**. A half-finished install shows as not working.
- **Guided.** Loading the Surf extension, and Linux commands that need sudo. SPOPI shows the command with **Copy** and checks the result with **Test**.

**Test all** runs the full check. Opening Packages runs the quick check (Pi, agent-browser, npm). When npm is not working, Recommended shows a notice that opens this page.

SPOPI never runs sudo, and it never redownloads a built-in file.

- **Code:** `src-tauri/src/dependencies/`, `public/app/settings/dependencies/`.

## Browser for Pi

Two browsers, two jobs. Both can be on. The prompt then says which to use.

- **Development browser (agent-browser).** Its own headless Chrome, with no logins. For pages and apps Pi builds. The switch is `ui.agentBrowser.enabled` (unset means on) and takes effect after a restart. Off drops it from Pi's PATH, hides the browser-check skill, and drops the live-debugging line. `agent-browser upgrade` is denied in Ask, Auto-edit, and Full access, so a per-user install cannot replace the bundled binary. `agent-browser install` still asks.
- **Your browser (Surf).** Drives the Chrome, Edge, or Brave you already use, with your logins. For research and signed-in sites. Its tools are in every prompt while it is on, and they ask in Ask and Auto-edit. The switch is the Pi package `npm:surf-cli` in `~/.pi/agent/settings.json`, so the Pi terminal follows it. Setup is: install the package (needs npm), load the unpacked extension, paste its id, restart the browser, then Test. Snap Chromium cannot connect. The native host needs Node.
- **Chrome.** agent-browser uses a Chrome, Brave, Playwright, or Puppeteer browser it finds, or `executablePath` in `~/.agent-browser/config.json`. Otherwise **Download browser**. Edge is not used as a fallback on this build: it was not installed on the machine where that was checked.
- **Code:** `extensions/spopi-verify/verify-skills.ts`, `extensions/bridge/spopi-awareness.ts`, `extensions/bridge/permission-recipes.ts`, `public/app/settings/dependencies/surf-card.js`.

## UI overlay and safe mode

You can ask Pi, in SPOPI's own chat, to change SPOPI's look, layout, or wording. The change survives app updates.

- **Which layer:** new behaviour belongs in a Pi extension or skill, which is installed once, works in the terminal too, and needs no copy of a shipped file. An extension already draws itself in SPOPI without any customization: see [Extension UI](#extension-ui). The overlay is for the interface: appearance, placement, wording, and controls that have to live in the window. The skill tells Pi the same thing.
- **How it works:** Pi uses the bundled `spopi-customize` skill and writes to the overlay folder (`<app data>/ui/`), never to the shipped UI. `user.css` loads last and applies without a reload; other files ask you to reload. Locale files there override only the keys they contain.
- **`user.js`:** the overlay's entry point for behaviour. The page loads `user.js` as a module on every start, whether or not you have one, and it can import other files you add beside it, so a button, a panel, or visual support for an extension needs no copy of a shipped file and nothing to merge when SPOPI updates. It should wait for the `spopi:ready` event before touching the app's DOM. Safe mode serves it empty.
- **What still needs a copy:** a new settings page (the tab bodies are elements in `index.html`), a rail button (`app/shell/rail.js`), a dock tab (`app/dock/dock.js`), and structural layout (`app/shell/shell-layout.js`).
- **Copying a shipped file:** Pi calls the `spopi_ui_copy` tool with the file's path from the skill's `ui-map.md`. It copies the file byte for byte to the same path in the overlay and never overwrites an existing copy. It refuses `index.html`, which the host builds from the shipped copy on every start, and locale files, where only the changed keys belong. Auto-edit allows it without asking. The map lists every file under `app/` and the top-level stylesheets by that path, without tests.
- **Light and dark:** rules that differ between light and dark themes, including the terminal's ANSI colors, follow the `data-scheme` attribute SPOPI sets from the active theme's `dark` flag, so no stylesheet carries a list of theme ids and a new theme needs no change outside its own token block. A token block may also set `--success`, `--warning`, `--error`, `--selection-bg`, and `--ansi-*` (for example `--ansi-green`; a bright color it leaves out follows its base) to tune status colors, text selection, and the terminal palette. Terracotta, Sage, Midnight, Dusk, and Clean do. Text and icons on an accent fill (primary buttons, the send button, toggle knobs, badges) use `--on-accent`, which is the theme's page color, so a light accent such as Dusk's grey stays readable.
- **Settings → Customizations:** the list of overrides, **Revert**, **Show three-way** for an override the new version made stale, and **Safe mode (shipped UI only)**.
- **After an update:** an override whose shipped file changed stops being served until it is merged or reverted.
- **Safe mode:** the settings toggle, `spopi.exe --safe`, or automatically after two starts that never finished loading. Serves the shipped UI only.
- **Code:** `src-tauri/src/host/ui_overlay/`, `public/app/settings/customizations-settings.js`, `src-tauri/resources/skills/spopi-customize/`, `extensions/bridge/spopi-ui-copy.ts`, `public/app/theme/`, `scripts/build-ui-map.mjs`.

## Pi looks at SPOPI

Pi can see the SPOPI window you are looking at, and, when you allow it, click through it.

- **Screenshots:** Pi calls `spopi_screenshot` and gets a PNG of the SPOPI window that shows its project (else the focused window). The tool card shows it as `[image image/png, … KB]`. Pi is told about it in one prompt line. The tool is registered in every session. The picture is the page that window is showing, so Pi can look at the editor or an error in the terminal. Windows captures it through WebView2, macOS through WKWebView, and Linux through WebKitGTK. None of these opens a debugging port.
- **Live debugging by the model (off by default):** Settings → General → Guard → **Live debugging by the model**. When on, every SPOPI window starts with a WebView2 debugging port on `127.0.0.1` (a free port picked at launch), and Pi is told the exact `agent-browser --cdp <port>` commands. Pi can then list, click, fill, and read the real window, not a copy. It is told to look and click only: not to type into the chat composer and not to navigate the window away.
- **Configure:** the switch saves `ui.modelLiveDebug` and takes effect after a restart (**Restart now** appears after a change).
- **Limits:** screenshots work on Windows, macOS, and Linux. Live debugging needs WebView2, so that switch is Windows only and stays disabled on other systems. While live debugging is on, any program on this computer can connect to that port and control SPOPI's windows. In Ask mode Pi still asks before each screenshot and each command.
- **Pi:** a bridge tool (`registerTool`) that returns an image block, and `agent-browser` through `bash`. SPOPI passes `SPOPI_HOST_ORIGIN` and, when live debugging is on, `SPOPI_CDP_PORT` to Pi.
- **Code:** `extensions/bridge/spopi-screenshot.ts`, `extensions/bridge/spopi-awareness.ts`, `src-tauri/src/host/server/http/screenshot.rs`, `src-tauri/src/platform/webview_capture.rs`, `src-tauri/src/platform/live_debug.rs`, `public/app/settings/live-debug-setting.js`.

## Settings pages

| Page | Holds |
|---|---|
| General | Language, projects folder, permission mode, live debugging by the model, thinking effort for new sessions, show thinking, queue modes, auto-compaction, auto-retry, idle session timeout, task notifications, updates |
| Appearance | Theme (Dawn is the default; also Dusk, Midnight, Clean, Terracotta, and Sage), chat and preview font size, preview theme |
| Terminal | Shell profile, theme, font, scrollback, smooth scrolling, WebGL |
| Packages | Installed, Recommended, Browse, Resources, Bundled with SPOPI |
| Dependencies | Built-in Pi and agent-browser, npm, Chrome for agent-browser, Surf |
| Usage | Cost dashboard |
| Models | Providers, API keys, `models.json`, sign-in |
| Advanced Configuration | Editors for Pi's agent config file, the global `AGENTS.md` (all projects), and `APPEND_SYSTEM.md` |
| Customizations | UI overrides and safe mode |
| Phone access | The phone listener |

**Idle session timeout** (`ui.runtimeIdleTimeoutMinutes`, default 30, up to 1440, 0 keeps sessions until exit) stops a session's Pi process after it has been idle that long.

## Phone access

Use SPOPI from a phone on your network. Off by default.

- **Use:** Settings → Phone access (or `/phone`). Turn it on, pick the network interface (a Tailscale address is listed first), pair a phone by scanning the code, and accept the current UI for phones.
- **Tiers:** Observe, Control (default), and Full. The host refuses anything the phone's tier does not allow. **Revoke** removes a device.
- **Configure:** port `ui.phone.port` (default 57640) and an address allowlist.
- **Security:** HTTPS only, with a certificate from SPOPI's local certificate authority (kept in the app data `tls` folder). Bound to one chosen address, never all interfaces. A pairing code works once. Phones see a UI only after you accept its fingerprint (shipped files plus overlay).
- **Layout:** below 600 px wide SPOPI switches to the phone layout, with Chat, Sessions, Changes, and More tabs.
- **Code:** `src-tauri/src/host/phone/`, `public/app/settings/phone-settings.js`.

## Keyboard shortcuts

`?` outside a text field, or `/hotkeys`, shows the list.

| Keys | Action |
|---|---|
| `Escape` | Stop the turn |
| `/` (outside a text field) | Open the command menu |
| `?` (outside a text field) | Show keyboard shortcuts |
| `Mod+P` | Search files |
| `Mod+K` | Inline edit (editor) / search sessions (elsewhere) |
| `Mod+L` (editor) | Ask Pi: mention the selection's file and lines in the composer |
| `Mod+N` | New session in this project |
| `Mod+Shift+N` | New project |
| `Mod+Alt+M` | Cycle model |
| `Mod+Shift+M` | Cycle permission mode |
| `Mod+B` | Toggle sidebar |
| `Mod+J` | Toggle dock |
| `Mod+Shift+L` | Toggle chat |
| `Mod+\` | Focus layout |
| Enter / Alt+Enter (while working) | Steer / queue a follow-up |

Code: `public/app/ui/keybindings.js`, `public/app/utils/keyboard-shortcuts.js`.

## Updates, app data, and environment

- **Install:** a GitHub release has two installers per OS, named `SPOPI_<version>_<os>_<arch>`: Windows NSIS (`SPOPI_*_win_x64-setup.exe`, `SPOPI_*_win_arm64-setup.exe`), macOS (`SPOPI_*_mac_arm64.dmg` for Apple Silicon, `SPOPI_*_mac_x64.dmg` for Intel), Linux AppImage (`SPOPI_*_linux_x64.AppImage`, `SPOPI_*_linux_arm64.AppImage`). Next to them are the two macOS updater archives and `latest.json`, which carries the update signatures. SPOPI is tested on Windows; the macOS and Linux builds are untested. It carries the UI, the bundled extensions, the `spopi-customize` skill, the Pi binary, and the agent-browser binary. Chrome is not included. On Windows the installer fetches WebView2 when it is missing. The NSIS setup's last page has **Create Start Menu shortcut** and **Create desktop shortcut**, both checked. Clear a box to skip that shortcut. A silent or passive install creates both.
- **First start:** SPOPI opens the newest chat whose folder still exists and is not a closed project, otherwise a new dated folder in the [projects folder](#projects). The first launch shows a short note: set the projects folder (Settings → General; default `SPOPI` in your home directory), add a model (Settings → Models), a Dependencies section, and Recommended packages. Dependencies checks npm and Chrome and always offers **Open Dependencies**, where **Test all** checks the rest. When npm is not working the note marks it Required. Recommended packages says what the [recommended packages](#recommended-packages) add and opens Settings → Packages. A button that opens Settings keeps the note, and it comes back when Settings closes. **Got it**, Escape, or a click outside stores `ui.firstRun.dismissed`, and it does not show again at start. Settings → Dependencies → **Show the first-start note** opens it again. The permission mode starts as Ask.
- **Updates:** Settings → General → **Check now**. Every release is stable; there is no beta channel. Check now needs a published GitHub release. A private repository does not serve that file to the app.
- **App data:** `%APPDATA%\spopi\` on Windows, `~/Library/Application Support/spopi/` on macOS, and `~/.config/spopi/` on Linux hold `spopi.sqlite3`, the UI overlay, and terminal state. A database from an older build in the Tauri `app.spopi.desktop` folder moves there on the next start. The WebView cache and the log stay in that Tauri folder (`%LOCALAPPDATA%\app.spopi.desktop\` on Windows).
- **Scratch profile:** `SPOPI_APP_DATA_DIR` moves SPOPI's app data; `PI_CODING_AGENT_DIR` moves Pi's agent folder. Together they run SPOPI without touching your real files.
- **Port:** `SPOPI_HOST_PORT`, otherwise the first free port from 57620 to 57651. The host listens on 127.0.0.1 only.
- **Passed to Pi:** `SPOPI_HOST_ORIGIN` (the host address, for `spopi_screenshot`) and, when live debugging is on, `SPOPI_CDP_PORT`.
- **Flags:** `spopi.exe --safe` starts in safe mode.
- **Open in the Pi terminal:** `pi -r` resumes the current session in the terminal, because both use `~/.pi/agent`.

## Not in SPOPI

- **Plan mode.** Ask Pi to write the plan to a markdown file, edit it in the editor, then ask Pi to work through it.
- **SSH remote workspaces.** Removed on 2026-09-27.
- **A second agent.** SPOPI never re-implements Pi's loop, tools, compaction, checkpoints, subagents, or MCP.
- **Tab completion in the editor and a codebase index.** Not built.
