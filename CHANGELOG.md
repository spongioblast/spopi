# Changelog

## 0.7.2

### Features

- Review comments stay as drafts and go to Pi as one review. Add to review keeps a comment, Send review sends them all, and they survive a restart.
- A git worktree is a project in the sidebar. New worktree creates one, and its menu can merge it back or remove it.
- Embedded Pi is 1.0.2. Built-in MCP and codemode are available. Settings → MCP adds, removes, and lists servers through `pi mcp`. Sign-in uses `/mcp` in the session. Enable, disable, and exposure use Pi's manager in the terminal.
- An MCP server that a project's `.pi/mcp.json` turns on, off, or re-exposes says so on its row in Settings → MCP, with the file's path.
- Tool cards show PNG, JPEG, GIF, and WebP results as thumbnails.
- Calls a script makes stay grouped under that script's card. A file the script changes still shows in Review.
- Auto-edit allows codemode and tool search. Each nested call is still gated.
- The ChatGPT button stays the Codex device-code sign-in, with a hint to run `/login` in the Pi terminal for ChatGPT on OpenAI.
- Phone access on Windows has **Allow through firewall**, which writes one inbound rule for the phone port and the allowed sources after the Windows admin prompt.
- The chat column stays between 280 px and 600 px.
- Think and attach live in the composer's More menu so the model name stays visible.
- The terminal shortcut is Mod+` (backtick) on every platform, including Mac.
- Settings → General → Language includes Deutsch and Italiano. A German or Italian system language selects them when the choice is System Default.
- The commit dialog shows who Git will record as the author. If none is set, it asks for a name and email and writes them to Git's config. Settings → General has the same fields.
- The Git panel can connect a repository to a remote. **Add remote…** takes a GitHub (or any Git host) URL and can push the branch right away; **↑ publish** pushes a branch that has no upstream yet; the branch menu changes or removes a remote. Pull without an upstream now says so instead of showing Git's message.

### Fixes

- Settings pages share one layout: titled cards with the same spacing on every page. Terminal, Dependencies, Models, Advanced Configuration, and the permission mode no longer sit as loose rows, theme swatches show their names, and the Recommended packages banner keeps its buttons on one line. A narrow window keeps those cards instead of shrinking their padding and corners.
- The Working tree diff keeps its place while Pi is still working. A running turn used to rebuild it on every update, which threw the scroll position back to the top.
- The commit dialog uses the shared dialog look. When Git has no name or email, it asks for them instead of showing the raw "Author identity unknown" error.
- Opening another file highlights that file's tab and scrolls the tab strip to it. The editor already showed the file, but the previous tab stayed marked as current, and a tab past the edge of a full strip stayed out of sight.
- On Windows the interface uses Segoe UI instead of falling back to Arial. The chat input uses the interface font instead of the browser's monospace, and Git diffs use the code font instead of Courier New.
- Review's empty message lines up with the heading in the secondary text colour, and the @ file menu no longer repeats a root file's name as its path.
- A new chat's Review says Pi has not changed files yet until Pi edits a file in it. It used to show the changes of another chat in the same project.
- The code editor and terminal use the regular weight of the bundled Fira Code again instead of drawing all text in bold.
- The embedded Pi download uses the `earendil-works/pi` release URL.
- A scratch profile (`SPOPI_APP_DATA_DIR`) no longer removes unused projects from the real projects folder at start.
- On Windows, a terminal whose shell exits is now marked exited instead of staying open with no process.
- Resume in terminal works in Git Bash when Pi's path has backslashes.
- Opening a terminal from a narrow window or from Focus now shows it.
- The top-right Pi button works again. It used to start a new project, so the window flashed and nothing opened. It now shows π and opens the bundled Pi on a new session of the project in a dock tab, and the chat stays put. That tab, like the MCP manager's, is named "Pi" and closes when Pi quits, and closing it reloads SPOPI's Pi so packages and settings changed there apply.
- Phone access could show only 127.0.0.1 with "No network interface was found". The page asked for the computer's addresses once at startup, often before the host connection was open. It now asks each time the Phone access tab opens, and again when the host connection comes back.
- Phone access picked the first address it found, often a WSL or Hyper-V adapter a phone cannot reach. It now selects the main network, names each adapter, lists virtual and VPN adapters last, leaves out 169.254 addresses, and remembers the choice.
- After **Pair this phone**, the desktop never showed the approval, so pairing could not finish. The prompt was added below the bottom edge of the window, where nothing scrolls. It is now a **Pair a phone?** dialog on top of everything, with the phone's name, address, and a tier described in plain words. Paired phones no longer receive pairing requests.
- An allowed phone showed up in Devices only after reloading the window. The list now updates when the request is answered, and the used QR code is cleared.
- Phone pairing used the same QR code every time, with no secret in it, and anyone on the network could request pairing. Claim numbers counted up, and the device token went to anyone who asked for a claim's result, so another device could pick up the token you approved for your phone. Each **Pair** click now makes a new secret that works once for 5 minutes. Requests without it are refused, claim ids are random, and the token goes once, only to the address that asked.
- Turning phone access off left the HTTPS listener running, and changing the interface or port started a second one next to it. Turning it off now closes the listener, a change moves it, and a port that cannot be bound is reported.
- Allowed sources accepted anything (for example `192.168.8g0.1/32`), so one typo silently blocked every phone, and an empty list let every address in. Each entry is now checked as an IPv4 address or range in the page and in the host, and an empty list is refused. The list follows the chosen interface until you type your own, so a saved `127.0.0.1/32` no longer blocks a phone on the LAN. It is applied when you leave the field instead of on every keystroke.
- The firewall row said "The firewall lets phones in" whenever SPOPI's rule covered the port, even when the rule allowed other addresses (such as an earlier `127.0.0.1`), so Windows blocked the phone with no button to fix it. It now compares the rule's addresses with the allowed sources and offers **Update firewall rule** when they differ. An empty or invalid list no longer writes a rule.
- A paired phone could list sessions but not chat, even at Full: opening a project, starting a runtime, new chats, and Pi's state were refused or answered with the desktop page, so the composer stayed disabled or a send failed with "UnknownInstance". The phone listener now serves the session routes, and the tiers say what each allows: Control chats (open projects, new chats, send, steer, abort, pick the model), and Full adds the terminal, Git changes, settings, packages, and project management. Phone access, opening things on the desktop, and folder pickers stay desktop only, and a phone's Settings → Phone access page says so instead of showing controls that fail.
- Phone access turned itself off whenever SPOPI restarted, so a paired phone stopped working until you opened Settings and switched it on again. It now comes back on with the saved interface, port, and sources.
- A phone without terminal rights no longer sends terminal requests that are always refused.
- A revoked phone no longer stays in the Devices list with a Revoke button.
- The tier list in the **Pair a phone?** dialog opened as a white system list with unreadable text. It uses SPOPI's dark list now, and answering a request in one desktop window closes it in the others.
- After you allowed a phone in Firefox, it still showed "A paired device is required". Over HTTP/2 Firefox sends each cookie in its own header, and the phone listener read only the first one, so it never saw the device cookie behind an earlier SPOPI cookie. It now reads them all. The cookie is also `SameSite=Lax` instead of `Strict` (which iOS browsers withhold on a page opened from the camera's QR scan), lasts 400 days or until the device is revoked instead of ending with the browser session, and is set on a normal page load through a one-time link. A phone without a valid cookie gets a page that says to pair it again.
- **Accept for phones** is gone. Every SPOPI update and every UI customization made phones wait until someone accepted the change on the desktop, so asking Pi to change the UI from the phone locked the phone out. The gate protected nothing: the same files run on the desktop, and the host enforces each phone's tier. Phones now load the current UI.
- The phone's pairing page and its status pages (not paired, link expired, address not allowed) were plain unstyled HTML. They now use SPOPI's dark card and blue accent, show a spinner while the desktop decides, and show errors in red.
- In Firefox the phone UI stayed a blank dark page. Firefox ignores an import map that comes after a module preload, so the app's imports failed to resolve. The import map now comes first. The phone also no longer probes `127.0.0.1` for local model servers (that is the phone itself), and the web manifest is fetched with the device cookie.
- After the host connection dropped (a host restart, or a phone switching networks), a window could stay disconnected: the reply to the reconnect threw while writing to the frozen `window.spopi`, so the connection was never marked ready.
- After SPOPI restarted, an open phone page reconnected but kept showing "Disconnected", and its chat still pointed at a Pi process that no longer existed. A reconnect now clears the status, and a page that finds a restarted SPOPI reloads itself.
- On a phone, the tab bar covered the composer's buttons, and its buttons sat on the bottom edge of the screen. The chat now ends above the bar, and the bar has space below its buttons.
- On a phone, picking or starting a chat from the Sessions tab now switches to the Chat tab, and a turn's file card switches to Changes. The More sheet's items look like SPOPI buttons, and loading a chat no longer opens the keyboard.
- Opening a chat could stop short of Pi's latest answer: history messages are drawn lazily, so the first jump to the bottom fell short once they got their real height. The chat now keeps following the bottom until it holds.
- Below the wide layout, Review was hidden behind the editor panel, so the Changes tab and a narrow window showed a title and an empty page. The editor's tab strip now sits above the review.
- Review marked files Pi wrote inside the project as "outside project" when pi-workspace-history had not recorded the project. It now uses the workspace folder as the project root, keeps the chat card's files and counts, and says the history has no record instead of "Pi didn't change any files".
- The header button that opened the project in another app (VS Code, Cursor, …) is gone. **Open in desktop app** in the file view's toolbar still opens a file with its default app.
- The Cockpit's cache-warming control now shows the saved mode at start instead of always showing Streaming.
- Screen readers no longer meet an invalid list in the session sidebar. The open session is announced as current, and arrow keys still move between sessions.
- The time to first token under a reply showed the whole reply's duration. It now runs from the model call to the first token, and tokens per second counts only the time after that.
- Chat links open only `http:`, `https:`, and `mailto:` addresses.
- A stale permission recipe no longer rewrites itself when SPOPI reads it. The composer posts a notice, and Settings → General → Guard has Update.
- Message times use the secondary text colour, so they stay readable on every theme.
- A project row in the session list folds from its own button. New chat and the actions menu sit beside it.
- An archived empty chat, one Pi never saved, can be deleted. It used to stay in the Archived list.
- The retry banner sits above the composer as one row with a styled **Abort** button. It used to drop below the composer with a bare button.
- The Git panel names the project folder it belongs to. After **Initialize repository**, the branch shows in the chat header and **New worktree…** is offered without a reload.
- Settings → MCP uses the same cards as the other Settings pages. The buttons, **Permission mode**, and the last check time share one row, and the example commands sit in one code box.
- The Windows installer failed to build: its script calls Restart Manager to close a running SPOPI, but never included that NSIS file.
- Keeping a project's chats in the project failed when the project was on another drive than Pi's folder ("cannot move the file to a different disk drive"). The chats are now copied over and removed from Pi's folder once the copy is complete.
- A server's **More** (`…`) button in Settings → MCP did nothing, so a server could not be removed there. The menu opened and the session list closed it again on the same click. **Add server** uses SPOPI's dark lists instead of white system lists, its argument and variable fields say what goes in them, and the hint shows `${NAME}` instead of a bare `$`.
- Settings → Customizations says the overrides are changes to SPOPI's own interface, shows the folder they live in, and explains each file's status. Safe mode has its own card and no longer repeats its name as the heading.
- Settings → Phone access is split into Connection, Pair a phone, and Devices cards. Port and allowed sources have sized fields. Pairing says what it does, and an empty device list says so. A help line no longer runs three unrelated texts together.
- The composer's **More** (`…`) menu is a labelled list (thinking level, **Attach image**, **Commands**) that opens fully inside the window. It used to show unlabelled icons and was cut off by the toolbar.
- The Files header's hidden-files button shows its state: a crossed-out eye while hidden files are hidden, an open highlighted eye while they show, with a tooltip for the next click.
- Review no longer asks to install pi-workspace-history when Pi already has it loaded and simply has not recorded a turn in this project yet; it says no files changed. When the package is missing, the message has an **Open Packages** button.
- **Collapse all** in the Files header uses two chevrons folding together. The old two-arrow icon read as "swap".
- On Linux, **Install Node.js** on Settings → Dependencies now works with one click. It used to list `sudo apt`/`dnf`/`pacman` commands to copy. SPOPI downloads the current Node.js LTS from nodejs.org, checks its SHA-256, and unpacks it into `~/.local/share/spopi/node`. A Mac without Homebrew gets the same download.
- The Linux AppImage opened a blank window on current distributions (Ubuntu 25.04 and later, Fedora 42 and later, Arch). It carried the build machine's `libwayland-client`, which the system's newer Mesa cannot use, so WebKit failed with "Could not create default EGL display: EGL_BAD_PARAMETER". The AppImage now uses the system's copy, and the release build fails if that library ever comes back.
- On Ubuntu 23.10 and later, the development browser's downloaded Chrome exited with "No usable sandbox!", because the system lets only a Chrome installed by the package manager create the namespaces its sandbox needs. There SPOPI now starts it with `--no-sandbox`, and Settings → Dependencies says so. Your own `AGENT_BROWSER_ARGS` or chosen browser is left alone.
- On Linux and macOS, a folder or unreadable file ending in `.jsonl` in Pi's sessions folder made SPOPI hang at full CPU while it listed sessions. It now skips that file.
- A paired phone could make SPOPI fetch any address through Cockpit's model-server metrics, change the phone access settings themselves, and, at Control, open any folder as a new project. Cockpit's server metrics and the phone settings are now desktop only, and a Control phone opens only projects SPOPI already knows.
- An empty allowed-sources list no longer becomes a firewall rule for every address, and the phone's status pages show names and messages as text, not markup.
- A session id with `..` or a slash could point the Changes history outside Pi's sessions folder. Package sources and branch names to merge that start with `-`, bearer-token variable names that are not valid names, and an unknown MCP scope on removal are refused instead of reaching `pi` or `git`.
- Cancelling the Node.js download stops the unpacking, removes the partial files, and a stalled download times out after 60 seconds without data. The package update check works when no project is open.
- The dock and chat buttons' tooltips show the Mac shortcut on a Mac instead of always `Ctrl`.

## 0.7.0

First release, and the base the next ones build on. SPOPI runs Pi (`pi --mode rpc`) with an editor, a terminal, Git, and per-turn review. What each feature does: [`docs/FEATURES.md`](https://github.com/spongioblast/spopi/blob/main/docs/FEATURES.md).
