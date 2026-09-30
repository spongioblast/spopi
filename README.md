# SPOPI

**Pi, GUI and an editor. Nothing hidden. Kept in the spirit of PI. There is no pink.**

https://github.com/user-attachments/assets/dc23677b-3ea7-45e0-aaeb-d356e6d327e7

SPOPI is a free, open-source desktop app for the [Pi](https://github.com/earendil-works/pi) coding agent. Your code sits in the middle. Pi's chat runs down the right side. A terminal and Git sit under the code. It works with any model, including one on your own GPU. There is no account and no telemetry, and you can see everything the agent does.

- **It is the real Pi.** SPOPI runs the Pi you already use, with the same settings, packages, and sessions as the terminal. Start a task here, close the window, and type `pi -r` to continue it in the terminal. Your chats are plain files in `~/.pi/agent`. Nothing is locked inside the app.
- **Any model.** Use Anthropic, OpenAI, your ChatGPT sign-in, or any OpenAI-compatible server. vLLM, Ollama, and LM Studio are handled fully, not added as an afterthought.
- **You see the work.** You see every tool call, every file it touched, and what each turn cost in tokens and time. You can open each turn's diff and undo it.
- **It checks itself.** When Pi edits files, SPOPI runs your project's type check before the turn ends. If Pi broke something, Pi gets the error and fixes it in the same turn.
- **You can make it yours.** Ask Pi to restyle or rearrange SPOPI itself.



## Work in the file, not in the chat

Select some code. Two buttons appear under it.

**Edit** (Ctrl+K, Cmd+K on a Mac) asks for one sentence, and Pi rewrites that selection in place. It works like any other edit: the file is saved, Ctrl+Z undoes it, and Git shows the change. There is no accept or reject step.

**Ask Pi** (Ctrl+L) puts a pointer such as `@src/todo.js:1-9` in the chat instead of pasting the code, so you can ask about those lines. You can also type `@` to point at any file.

![addTodo selected, with the edit prompt under the selection.](docs/readme/edit.png)

The editor, file search, and previews for Markdown, HTML, images, PDF, and Office files are all in the same window. So is a real terminal: Git Bash, PowerShell, or your usual shell.

## Every turn has a diff

When Pi changes files, the turn ends with "Changed 3 files · Review". Review shows exactly what changed, for that turn or for the whole session. **Undo last turn** puts everything back. Per-turn review and undo come from the recommended `pi-workspace-history` package.

![The diff for the due date added to addTodo: removed lines in red, added lines in green.](docs/readme/review.png)

The Git panel covers the rest: stage, discard, commit (Pi can write the message), pull, push, and history. Its diffs open in the same view as Review.

![The Git panel on main, with todo.js changed: 11 lines added, 1 removed.](docs/readme/git.png)

## Local models work fully

Paste a server address and SPOPI detects the server type and the context size. **Set up model** sends a few short test requests to find out whether the model thinks, how its thinking is switched on and off, and whether it accepts images. That way the Think button only offers what your server actually accepts. With nothing open, the home screen lists the vLLM, Ollama, and LM Studio servers running on this machine.

![The model menu, with a local model selected.](docs/readme/model.png)

You can switch models in the middle of a session. Try the same question again with another model from any point in the conversation.

**Cockpit** (`/cockpit`) shows what each prompt cost: tokens, speed, cache hits, and time. On a vLLM server it also shows KV cache, time to first token, queue, and prefill. It is useful when you are tuning a model on your own hardware. Settings → Usage tracks spending on cloud models.

## It checks its own work

After a turn that edits files, SPOPI runs your project's check (`tsc`, `cargo check`, `go vet`, or the `check` script in `package.json`). If the check fails in a file Pi just changed, the error goes back to Pi, and Pi fixes it before the turn ends. If Pi cannot fix it, you are told.

Pi can also look at what it built. SPOPI includes [agent-browser](https://github.com/vercel-labs/agent-browser), so Pi can open your local app, click through it, and look at screenshots. It needs a Chrome, which Settings → Dependencies can download. `/skill:verify-recipe` teaches Pi how your project is built, tested, and started, and saves that as a skill Pi reads whenever it needs to check its work.

## Nothing hidden

- **The turn stays readable.** Thinking and tool calls fold into one "Worked for …" row that counts the files read, commands run, and files edited. The answer stays visible. Open the row to see every step.
- **You choose the permission mode.** **Ask** checks with you before each command or edit. **Auto-edit** edits files freely and asks before shell commands. **Full access** tells you once and then stops asking. Approval requests appear above the chat box, not in pop-ups. SPOPI does not pretend to be a sandbox: Pi runs with your user's rights, and Settings lists ways to run Pi in a container if you need isolation.
- **Context stays small.** A long tool result, such as a 10,000-line build log, is saved to a file. Pi gets the path, the first lines, and the last lines. You still see all of it.
- **Plans are files.** SPOPI has no hidden plan mode. Ask Pi to write the plan as a Markdown file, edit it yourself, and then ask Pi to work through it.
- **Your configuration is plain files.** Keys, models, prompts, and `AGENTS.md` can all be edited in Settings, and they are the same files the Pi terminal reads.



## Keep working while Pi works

While Pi is working, press Enter to steer the current turn, or Alt+Enter to queue a follow-up. The session tree lets you go back to any point, edit a message, fork, or summarize. Finished turns send a desktop notification when the window is in the background.

Pi packages work here as they do in the terminal. Install them from Settings → Packages. Their dialogs, questions, panels, and slash commands appear in SPOPI without any extra setup. The recommended ones add per-turn undo (`pi-workspace-history`), live diagnostics (`pi-lens`), subagents (`pi-subagents`), and Git worktrees (`@pify/worktree`).

## Make it yours

Ask Pi to change SPOPI itself: its colors, its layout, its wording, or a new button. The changes go into a separate folder, not into the app files, so they survive updates. If an update touches a file you changed, SPOPI shows you both versions and lets you merge them. If something breaks, safe mode starts the stock interface. Pi can take a screenshot of the SPOPI window to see what it is changing.

SPOPI comes with six themes (Dawn, Dusk, Midnight, Clean, Terracotta, and Sage) and four languages (English, Spanish, Japanese, and Chinese).

## From your phone

Turn on Phone access, scan the code, and follow or steer a session from your phone on the same network or over Tailscale. It is off by default. It uses HTTPS only, and each pairing code works once. You decide what a phone may do: watch, control, or everything.

## What it doesn't do

SPOPI has no autocomplete while you type and no codebase index. It is not a second agent: planning, tools, compaction, subagents, and MCP are all Pi and its packages. If Pi can do something, SPOPI shows it. If Pi cannot, SPOPI does not fake it.

## How it's built

SPOPI is a [Tauri 2](https://v2.tauri.app/) app. Rust runs the window, the files, Git, and the terminal. The interface is plain JavaScript in the webview that is already on your computer: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. Pi is a separate program, started as `pi --mode rpc`, the same way the Pi terminal runs. SPOPI does not contain a second copy of Pi's internals.

Why not Electron? An Electron app ships its own Chrome and its own Node, and the interface is a minified bundle packed inside the installer. Changing that interface means rebuilding the app. SPOPI does not carry a browser, and the interface stays ordinary files, so you can ask Pi to restyle it without a new build. Your changes live in a separate folder and should survive updates. To be tested.

## Install

Download the installer for your system from [Releases](https://github.com/spongioblast/spopi/releases):

- Windows: `SPOPI_*_win_x64-setup.exe` (most PCs) or `SPOPI_*_win_arm64-setup.exe` (ARM laptops)
- macOS: `SPOPI_*_mac_arm64.dmg` (Apple Silicon) or `SPOPI_*_mac_x64.dmg` (Intel), untested
- Linux: `SPOPI_*_linux_x64.AppImage` or `SPOPI_*_linux_arm64.AppImage`, untested

SPOPI is developed and tested on Windows. The macOS and Linux builds come out of the same CI, but nobody has run them yet. If you try one, please [open an issue](https://github.com/spongioblast/spopi/issues) and say how it went.

Pi and the browser tool are included. The installers are not code-signed yet:

- **Windows:** SmartScreen may warn you. Click **More info**, then **Run anyway**.
- **macOS:** Gatekeeper may block the first start. Go to System Settings → Privacy & Security and click **Open Anyway**.

SPOPI updates itself from Settings → General.

On first start, a short note walks you through the projects folder, a model, Settings → Dependencies, and the recommended packages. If you already use Pi, your models and sessions are already there.

### Requirements

The installer brings Pi and agent-browser with it. You do not need to install Pi yourself. Settings → Dependencies shows what is missing on your machine. It can install Node.js and a Chrome for you, and **Test all** checks everything again.

On Windows:


| What                                                | Needed for                                                                                                              | Install                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Git for Windows](https://git-scm.com/download/win) | **Required.** Pi runs its shell commands in Git Bash, and the Git panel uses Git.                                       | `winget install --id Git.Git -e`                                                |
| WebView2                                            | **Required.** SPOPI's window. Windows 11 has it. On Windows 10 the installer downloads it.                              | Nothing to do                                                                   |
| [Node.js](https://nodejs.org) LTS (includes npm)    | **Recommended.** Installing Pi packages, including the recommended ones for per-turn undo, diagnostics, and subagents.  | `winget install OpenJS.NodeJS.LTS`, or one click in Settings → Dependencies     |
| Chrome                                              | **Recommended.** Lets Pi open and click through the app it built. An installed Chrome or Brave works; Edge is not used. | **Download browser** in Settings → Dependencies                                 |
| [ripgrep](https://github.com/BurntSushi/ripgrep)    | Optional. Faster file search in the sidebar.                                                                            | `winget install BurntSushi.ripgrep.MSVC`                                        |
| Python 3.10+ with MarkItDown                        | Optional. Preview Word, PowerPoint, and Excel files.                                                                    | `winget install Python.Python.3.12`, then `py -m pip install "markitdown[all]"` |


Restart SPOPI after installing Git or Node.js so it picks up the new `PATH`.

On macOS and Linux (untested), Git and a shell are usually there already. Install Node.js from your package manager or [nodejs.org](https://nodejs.org). Settings → Dependencies shows the exact commands for your system.

## Build from source

You need Rust, Bun, and Node 22 or newer, plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system. On Windows, a few scripts use Git Bash, and Rust needs the Microsoft C++ Build Tools:

```powershell
winget install --id Git.Git -e
winget install Rustlang.Rustup Oven-sh.Bun OpenJS.NodeJS.LTS
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Then:

```bash
bun install --frozen-lockfile
bun run fetch:pi
bun run dev
```

`bun run build` makes an installer for the system you are on.

## Docs

- `[docs/FEATURES.md](./docs/FEATURES.md)`: every feature, how to use it, how to configure or turn it off, and what it does not do.
- `[ARCHITECTURE.md](./ARCHITECTURE.md)`: the transport, the host, the security boundary, and the rules the code keeps.
- `[AGENTS.md](./AGENTS.md)`: how to change the code, for you or for Pi.
- `[docs/DESIGN.md](./docs/DESIGN.md)`: the design tokens.
- `[CHANGELOG.md](./CHANGELOG.md)`: what each release added and fixed.
- `[docs/PI_BUMP.md](./docs/PI_BUMP.md)`: how to update the Pi that ships inside SPOPI.



## License

MIT. See `[LICENSE](./LICENSE)`.

## Thanks

SPOPI is based on much of the initial work of [Tau](https://github.com/deflating/tau) and [Picot](https://github.com/shixin-guo/picot). Thank you!