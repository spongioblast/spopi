---
name: browser-check
description: Look at and click through a web page or webview UI you built or changed, using the agent-browser CLI. Take a screenshot, read it, and fix what you see. Use after any change a user would see in a browser.
---

# Check a UI in the browser

Text output does not show layout. Look at the page after a visible change, and click through what you changed.

## Start the app

Use the launch step from the project's `verify` skill if there is one. A server started from the shell must run in the background and write to a log, or the shell call never returns. Save its process id so you can stop exactly that process later:

```bash
mkdir -p .pi/tmp && (npm run dev > .pi/tmp/dev.log 2>&1 & echo $! > .pi/tmp/dev.pid)
```

Read `.pi/tmp/dev.log` for the URL. Wait until the server answers (`curl -sf <url>`) before opening it.

## Look

```bash
mkdir -p .pi/tmp/screens
agent-browser set viewport 1280 800
agent-browser open http://127.0.0.1:5173
agent-browser snapshot -i
agent-browser screenshot "$PWD/.pi/tmp/screens/home.png"
```

Give screenshot paths in full (`"$PWD/..."`). A path that starts with `.` is read as a CSS selector, and the file lands somewhere else.

`snapshot -i` lists the interactive elements with refs (`@e1`, `@e2`). It is cheap. Use it to find elements and to check text.

Then `read` the PNG. A screenshot costs far more context than a snapshot, so take one when the look matters: after a layout or style change, and once at the end.

Check the screenshot against the request. Look for overlap, cut-off or wrapped text, blank areas, misaligned edges, low contrast, and whether the change is visible at all. If something is wrong, fix the code and look again.

## Click through it

```bash
agent-browser click @e3
agent-browser fill @e5 "hello"
agent-browser press Enter
agent-browser wait 500
agent-browser snapshot -i
```

Refs change when the page changes. Take a new snapshot before you use a ref again.

After an interaction, check the result, not just that the command succeeded: the text that should appear, the item that should be added, the dialog that should close.

## Other checks

- `agent-browser errors` and `agent-browser console` show page errors and console output. Check them after loading and after each interaction.
- `agent-browser get text @e4` and `get count "#items li"` read text and counts. Prefer them to `eval`, which asks the user first.
- `agent-browser get styles @e4` prints every computed property, several hundred lines. Filter it: `| grep -E '^(color|background-color):'`.
- `agent-browser a11y` runs an axe accessibility audit.
- `agent-browser set viewport 390 844` checks a phone-sized layout.
- `agent-browser set media dark` checks dark mode.
- `agent-browser diff screenshot --baseline "$PWD/.pi/tmp/screens/home.png"` compares against an earlier screenshot.
- `agent-browser screenshot --annotate "$PWD/.pi/tmp/screens/labels.png"` numbers the clickable elements to match the refs.
- `agent-browser <command> --help` explains one command.

## Desktop apps with a webview

- Tauri on Windows (WebView2): start the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then `agent-browser --cdp 9222 snapshot -i`.
- Electron: start it with `--remote-debugging-port=9222`, then the same.
- SPOPI itself, when you run inside it: call `spopi_screenshot`, or use the `--cdp` port the prompt names. Do not open SPOPI's host address in another browser or build a copy of its page.

## Rules

- If agent-browser reports that no browser is installed, stop and tell the user to open Settings → Dependencies and press Download browser. Never run `agent-browser install` or `agent-browser upgrade` yourself.
- Open local URLs (`127.0.0.1`, `localhost`) only, unless the user asked for another site.
- Keep screenshots in `.pi/tmp/screens/`. That folder is not committed.
- When you are done, run `agent-browser close` and stop only the server you started. On Windows a plain `kill` leaves the child of `npm run` running, so stop the whole tree:

  ```bash
  pid=$(cat .pi/tmp/dev.pid); if [ -e "/proc/$pid/winpid" ]; then taskkill //PID "$(cat /proc/$pid/winpid)" //T //F; else kill "$pid"; fi
  ```

  Never stop processes by name or by a command-line pattern; other programs on this machine run the same tools.
