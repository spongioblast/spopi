# SPOPI UI map

Generated. Do not edit by hand. Paths are relative to the shipped UI folder; the same path in the overlay replaces the file. Tests are left out.

## app

- `app/app.js` — Native session composition root: Pi RPC, workbench, preview, git, and chat.
- `app/types.js` — JSDoc names for the Pi RPC types the app uses.

## chat

- `app/chat/chat-column.css` — Chat column at 380–600px: compact composer, turn meta, live strip, turn rail.
- `app/chat/compact-coordinator.js` — Coordinates user-requested context compaction across independent UI entry points.
- `app/chat/context-chips.js` — Removable composer chips for Ctrl+L selections. Source stays in the chip, not a second prompt copy.
- `app/chat/context-inspector-model.js` — Buckets messages the way pi-context-view walks them for the context inspector tab.
- `app/chat/context-inspector-tab.js` — Context inspector tab: pin / drop / compact over the bucketed walk.
- `app/chat/context-pins.js` — Per-session pins for compact customInstructions, and one-way context drops.
- `app/chat/custom-message-note.js` — Text of a Pi custom_message entry that an extension asked to show (display: true).
- `app/chat/file-actions.js` — File preview and run-in-terminal are session-store actions.
- `app/chat/history-render.js` — Draws turns as prompt, one work row, then the final answer, live and from history.
- `app/chat/live-label.js` — Names what Pi is doing right now for the live strip: the running tool and its target,
- `app/chat/live-strip.js` — One 22px row above the composer while the agent runs: tool, elapsed, Steer, Stop.
- `app/chat/message-actions.js` — Fork and edit on a user message are session-store actions.
- `app/chat/messages.css` — Styles the scrolling message list and its empty state.
- `app/chat/mount-history.js` — Transcript history mount and snapshot hydration.
- `app/chat/retry-banner.css` — The single retry and endpoint-down banner above the composer.
- `app/chat/retry-banner.js` — One retry banner for repeated model failures.
- `app/chat/rpiv-todo-mirror.css` — Styles the mirrored todo panel that tracks an extension widget.
- `app/chat/rpiv-todo-mirror.js` — Mirrors an extension todo widget into a panel beside the chat.
- `app/chat/runtime-events.js` — Foreground Pi runtime events: stream, tools, settle, fork consume.
- `app/chat/stop-run.js` — Stop = clear_queue, abort, abort_bash, in that order; returns cleared text.
- `app/chat/transcript-reducer.js` — Pure transcript reducer for one window's streaming session state.
- `app/chat/transcript-turns.js` — Builds one turn from transcript events: work steps, files, and thinking.
- `app/chat/turn-block.css` — Styles one quiet turn: header, work row, answer, the review card, and the undone marker.
- `app/chat/turn-block.js` — Renders one quiet turn: header, thinking, one work row, the answer, and files.
- `app/chat/turn-files.js` — Files one prompt wrote or edited, from rebuilt history or from the live turns.
- `app/chat/turn-meta.js` — Restore/Fork on user turns and Tier 0 timing chips on assistant turns.
- `app/chat/undo-marker.js` — After Pi's /undo the chat shows Pi's rewound branch, and one line marks the undone turn.
- `app/chat/wire-chat-file-actions.js` — Chat file.preview and terminal.run subscriptions, plus Run-file late binding.
- `app/chat/workspace-history-client.js` — GUI over pi-workspace-history slash commands and its on-disk shadow git.

## composer

- `app/composer/approval-bar.css` — Docked approval card that replaces the composer input while Pi waits.
- `app/composer/approval-bar.js` — Docked approval card that replaces the composer while Pi waits.
- `app/composer/approval-prompt.js` — Reads a permission prompt's "label : value" fact lines into a headline, a subject,
- `app/composer/at-file-mention.css` — Styles the @-file mention menu in the composer.
- `app/composer/composer-actions.js` — Selection-to-chat and inline edit are composer store actions.
- `app/composer/composer-autoresize.js` — Grows the composer textarea with its text up to a maximum height.
- `app/composer/composer-images.css` — Styles image attachments on the composer.
- `app/composer/composer-images.js` — Attaches pasted and picked images to the composer.
- `app/composer/composer-paste-offload.js` — Offers an explicit file-offload action for large pasted composer text.
- `app/composer/composer-pi-sync.js` — Makes the composer show the model and thinking level Pi actually runs.
- `app/composer/composer-slash-menu.css` — Styles the slash-command menu above the composer.
- `app/composer/composer-slash-menu.js` — Shows the slash-command menu as the composer text changes.
- `app/composer/composer-submit.js` — Sends the composer text, attachments, and queue mode.
- `app/composer/composer.css` — Styles the floating composer card, toolbar, and send button.
- `app/composer/guard-chip.js` — Paints the composer guard chip and cycles the permission recipe.
- `app/composer/last-model-store.js` — Persists the last manually selected composer model in the ui.* store.
- `app/composer/mention-chips.js` — Inline pills for composer @-mentions. A mirror paints each @token as a pill
- `app/composer/model-config-refresh.js` — Re-selects the open session's model after its provider changed in models.json.
- `app/composer/model-controls.js` — Composer model menu and thinking-level control.
- `app/composer/model-dropdown.js` — Composer model menu: search, scoped stars, empty-state, open/close.
- `app/composer/model-selection.js` — Compares provider-scoped model identities for composer selection state.
- `app/composer/model-visibility.js` — Catalog visibility filter, context-window lookup, and thinking-level events.
- `app/composer/mount-composer.js` — Composer submit path: resolve the input, then send or run a builtin.
- `app/composer/queued-messages.css` — Styles the strip of queued steering and follow-up messages.
- `app/composer/queued-messages.js` — Renders messages waiting to be sent as steering or follow-up.
- `app/composer/send-model-gate.js` — Holds back a prompt while the model picker has no usable model.
- `app/composer/session-chrome.js` — Paints the retry banner, guard chip, and status footer after each transcript update.
- `app/composer/slash-commands.js` — Builds the slash-command catalog and matches the text being typed.
- `app/composer/slash-sources.js` — Slash-command sources and the order they appear in the menu.

## dock

- `app/dock/dock.css` — Dock under the editor: tab strip, status chips, Cockpit layout.
- `app/dock/dock.js` — Editor-column dock: Terminal, Problems, Cockpit + status strip.
- `app/dock/lens-findings.js` — Reads pi-lens diagnostics from a finished tool result.
- `app/dock/problems-dock.css` — Problems dock groups pi-lens diagnostics by file.
- `app/dock/problems-dock.js` — Problems dock lists pi-lens diagnostics grouped by file.
- `app/dock/terminal-panel.js` — Terminal Panel: DOM, tab bar, collapse/expand, height clamp, close-risk.
- `app/dock/terminal-profile-menu.js` — Dock + button profile picker: default-profile create, chevron and

## editor

- `app/editor/center-mode.js` — Picks Home, Work, Editor, Review, or a subagent's transcript for the center pane.
- `app/editor/center-paint.js` — Paints the center as Home, Work, Editor, Review, or a subagent's transcript.
- `app/editor/center-tabs.js` — Session tree and Context as ext-tabs on the file preview tab bar.
- `app/editor/code-editor.js` — CodeMirror editor lifecycle for the file preview pane.
- `app/editor/editor-context.js` — Reads the CodeMirror selection and turns it into a chat context payload.
- `app/editor/file-classify.js` — Classifies a path as markdown, code, image, pdf, or plain text.
- `app/editor/file-language.js` — CodeMirror language extension for a file path.
- `app/editor/file-pdf-preview.js` — Renders a PDF into canvases with pdf.js.
- `app/editor/file-preview-follow.js` — Opens or refreshes the file preview when the agent writes a file.
- `app/editor/file-preview-html.js` — Live HTML preview renderer for the file preview panel.
- `app/editor/file-preview-markdown.js` — Renders a Markdown preview and the copy buttons inside it.
- `app/editor/file-preview-panel.css` — Styles the file preview and editor pane.
- `app/editor/file-preview-panel.js` — Coordinates file preview tabs and panel layout.
- `app/editor/file-preview-prefs.js` — Persists the file preview's panel ratio, wrap, and auto-save choice.
- `app/editor/file-preview-renderers.js` — Picks a preview renderer from the file classification.
- `app/editor/file-tab-state.js` — Remembers which preview tabs are open and which one is active.
- `app/editor/file-text.js` — Line-ending helpers for the file preview dirty check and save.
- `app/editor/file-type-icons.js` — Shared file/Git object-icon resolver backed by a curated, pinned
- `app/editor/home-pane.js` — Workspace home when no editor tab is open — never a blank center.
- `app/editor/inline-edit-host.js` — Hosts the Ctrl+K prompt: one model call, then the edit lands in the editor.
- `app/editor/inline-edit.css` — Styles the Ctrl+K prompt over the editor and the read-only hunk list.
- `app/editor/inline-edit.js` — Ctrl+K inline edit: the prompt, the bridge model call, and applying the result.
- `app/editor/lead-tab.js` — Tabs drawn before the file tabs, keyed by owner: Review and a subagent's transcript.
- `app/editor/merge-view.js` — Line-diff hunk model and a read-only hunk list for tool cards and review.
- `app/editor/mount-file-preview.js` — File preview panel mount for the center editor column.
- `app/editor/review-pane.js` — Shows what Pi changed, one file at a time, for a turn, the session, or git.
- `app/editor/review/review-comments.js` — Formats a review comment and the draft card under a hunk.
- `app/editor/review/review-diff-model.js` — Builds a numbered unified diff with context, folded gaps, and stable hunk keys.
- `app/editor/review/review-diff.js` — Renders one changed file in the editor slot, with a pager and hunk comments.
- `app/editor/review/review-list.js` — Renders the Review sidebar: scope, and one row per changed file.
- `app/editor/review/review-sources.js` — Loads one review scope: a turn, the session, or the git working tree.
- `app/editor/review/review.css` — Styles the review diff in the editor slot.
- `app/editor/selection-actions.css` — Styles the Edit and Ask Pi buttons that float beside an editor selection.
- `app/editor/selection-actions.js` — Edit and Ask Pi buttons that float beside a non-empty editor selection.

## extension-ui

- `app/extension-ui/custom-ui-panel.css` — Styles the custom extension UI overlay.
- `app/extension-ui/custom-ui-panel.js` — Renders `ctx.ui.custom()` extension overlays bridged out of the pi process.
- `app/extension-ui/dialog.css` — Styles extension modal dialogs.
- `app/extension-ui/dialog.js` — Shows an extension dialog and parses its options.
- `app/extension-ui/extension-command-compatibility.js` — Learns which extension slash commands need the real terminal.
- `app/extension-ui/extension-ui-host.js` — Routes extension UI requests to the dialog, select, or custom panel.
- `app/extension-ui/extension-widgets.css` — (no ABOUTME)
- `app/extension-ui/extension-widgets.js` — Renders `ctx.ui.setWidget()` content from extensions around the composer.
- `app/extension-ui/inline-extension-prompt.css` — Styles inline extension prompts in the chat timeline.
- `app/extension-ui/inline-extension-prompt.js` — Shows an inline ask-user prompt inside the chat column.

## files

- `app/files/file-browser.css` — File tree row text and Git state (tinted name plus a bare letter).
- `app/files/file-search.js` — File search inside the Files panel, scoped to the active workspace.
- `app/files/file-tree-hooks.js` — Connects the file tree to open, reveal, and refresh actions.
- `app/files/file-tree-model.js` — Lazy file-tree state: children map, expanded set, generation, git overlay.
- `app/files/file-tree.css` — Compact lazy file-tree rows for the Files rail panel.
- `app/files/file-tree.js` — Lazy Files tree: expand one directory per host list_files call.
- `app/files/mount-file-browser.js` — Wires the Files rail panel to FileTree: refresh, hidden, Finder, collapse.
- `app/files/patch-utils.js` — Flattens a unified diff into display lines.
- `app/files/path-utils.js` — Normalizes local filesystem paths for browser-side workspace features.
- `app/files/search-model.js` — Normalizes a search query and groups hits by file.

## git

- `app/git/git-branch-menu.js` — Opens the branch menu and checks that a new name is safe.
- `app/git/git-client.js` — Sends owner-scoped Git broker commands with workspace-generation binding.
- `app/git/git-confirm-dialog.js` — Asks for confirmation before a destructive git action.
- `app/git/git-history-panel.js` — Renders Git first-parent history, commit details, and pagination.
- `app/git/git-init-prompt.js` — Empty Git panel for a folder that is not a repository yet.
- `app/git/git-panel-actions.js` — Commit, push, pull, and discard actions for the Git panel.
- `app/git/git-panel-integration.js` — Connects the Git panel to the native Host runtime transport.
- `app/git/git-panel.js` — Owns the Git tab, status groups, and safe user-visible Git actions.
- `app/git/git-refresh-hooks.js` — Refreshes the git panel after a terminal command finishes.
- `app/git/git-row-actions.js` — Renders one git file row and opens that file in the preview.
- `app/git/git-toolbar.js` — Renders the git toolbar, including the amend checkbox.

## i18n

- `app/i18n/i18n.js` — Loads the locale catalogs and translates keys for the UI.

## metrics

- `app/metrics/cache-warming-control.js` — Cockpit control for Pi's cacheWarming setting.
- `app/metrics/metrics-format.js` — Formats Cockpit numbers, durations, and Pi phase names.
- `app/metrics/metrics-model.js` — Folds pi runtime events and vLLM /metrics scrapes into one snapshot.
- `app/metrics/metrics-overlay.css` — Styles the metrics overlay and its charts.
- `app/metrics/metrics-overlay.js` — Cockpit: Pi's turn telemetry for any model, plus model-server counters when its /metrics answers.
- `app/metrics/thinking-budget.js` — Thinking-budget presets for vllm-thinking-budget.ts (vLLM only).

## notifications

- `app/notifications/notification-center.css` — Styles the stack of in-app notices.
- `app/notifications/notification-center.js` — Stacks in-app notices and removes them when they are dismissed.
- `app/notifications/task-completion-notifications.js` — Sends an OS notification when a turn finishes and the window is unfocused.

## packages

- `app/packages/extension-errors.js` — Remembers extension_error frames for one Pi runtime.
- `app/packages/install-status.js` — Turns a package install error into a short status the page can show.
- `app/packages/npm-notice.js` — Tells the Packages page that npm is not working.
- `app/packages/packages-add-skills.css` — Styles the add-skills form in Packages.
- `app/packages/packages-add-skills.js` — Settings flow that installs skills from a folder the user picks.
- `app/packages/packages-browse.css` — Styles the community package browser.
- `app/packages/packages-browse.js` — Browses community packages and starts an install from a chosen source.
- `app/packages/packages-bundled.js` — "Bundled with SPOPI" switches on the Packages page.
- `app/packages/packages-installed.css` — Styles Packages → Installed: bundled switches, toolbar, list, and detail pane.
- `app/packages/packages-installed.js` — Lists installed packages and can disable or remove one.
- `app/packages/packages-page.js` — Settings-hosted Recommended-for-SPOPI cards. Never relocates the package manager.
- `app/packages/packages-recommended.js` — Lists the recommended packages and which of them are missing.
- `app/packages/packages-resources.css` — Styles the package resources list.
- `app/packages/packages-resources.js` — Packages → Resources: every Pi extension, skill, prompt, and theme with a toggle.

## pair

- `app/pair/pair-screen.js` — Pairing screen shown at /pair before a phone has a device cookie.
- `app/pair/phone-claim.js` — Desktop approval for a phone that asked to pair.

## perf

- `app/perf/startup-marks.js` — One-shot startup marks the workspace perf script reads.

## session

- `app/session/app-actions.js` — Shared workspace action source feeding the Info panel's app rows.
- `app/session/assistant-error.js` — Pulls a readable error string out of an assistant message or a runtime event.
- `app/session/assistant-message-stream.js` — Accumulates streaming assistant text and tool calls into one message object.
- `app/session/bootstrap-target.js` — Reconciles the route target with the snapshot target after bootstrap.
- `app/session/context-usage.js` — Shows the latest assistant token usage above the composer.
- `app/session/info-panel.css` — Info right-side panel — fixed workspace actions + scrollable session tree.
- `app/session/info-panel.js` — Info right-side panel — fixed workspace actions plus scrollable history.
- `app/session/info-sidebar.js` — Info sidebar mount — session tree, workspace path, and resume.
- `app/session/instance-swap.css` — Styles the overlay shown while one session window replaces another.
- `app/session/message-fork.js` — Fork and Edit on user bubbles: resolve the Pi entry id, then fork or rewind.
- `app/session/missing-workspace.js` — Tracks project folders the host could not open.
- `app/session/mount-session-sidebar.js` — Mounts SessionSidebar + search dialog onto the session list.
- `app/session/pinned-items.js` — Persists ordered workspace and session Pins in the ui.* preference store.
- `app/session/projects-folder-fallback.js` — Tells the user once when startup could not use their Projects folder.
- `app/session/session-created-action.js` — A new session target is a store action, not a window event.
- `app/session/session-export.js` — Export the active session to HTML through Pi, then reveal the file.
- `app/session/session-info.css` — Styles the session title and id cluster in the header.
- `app/session/session-info.js` — Describes the active session file and id for the header.
- `app/session/session-log.js` — Session-load diagnostics and the short title taken from a message.
- `app/session/session-menu.js` — Session context-menu rows, including duplicate and add label.
- `app/session/session-navigation.js` — Handles choosing a session in the sidebar.
- `app/session/session-runtime.js` — One session runtime per window: transcript state plus start and switch.
- `app/session/session-search-dialog.css` — Styles the session search dialog and its result list.
- `app/session/session-search-dialog.js` — Opens the session search dialog from its keyboard shortcut.
- `app/session/session-sidebar-sections.js` — Pinned rows and project groups for the session sidebar.
- `app/session/session-sidebar.css` — Styles the session list, its groups, and the sidebar actions.
- `app/session/session-sidebar.js` — Renders the workspace session list and its grouping.
- `app/session/session-status.js` — Tracks whether the active session is idle, working, or showing an error.
- `app/session/session-store.js` — Holds the session view state and applies pure reductions to it.
- `app/session/session-tree-host.js` — Holds the session tree panel and the latest get_tree snapshot.
- `app/session/session-tree-model.js` — Flatten Pi get_tree / branch_summary payloads for the session tree center tab.
- `app/session/session-tree-tab.js` — Center-tab view over Pi get_tree / navigate_tree / fork / branch_summary.
- `app/session/session-tree.css` — Session tree rows in the center tab.
- `app/session/session-tree.js` — Pure model that turns a Pi session's native entry tree into render rows.
- `app/session/session-ui-state.js` — Coordinates host-backed per-session model/thinking profiles.
- `app/session/sidebar-open-project.js` — Gives the open project a sidebar group before it has a saved chat.
- `app/session/sidebar-workspace-group.js` — Reusable sidebar region and workspace-group DOM builders for PINNED and PROJECTS.
- `app/session/switch-session.js` — In-window session switch paints from one get_tree call.
- `app/session/window-project.js` — Hands the project a page showed to the next page in the same tab or window.
- `app/session/workspace-actions.js` — Creates sessions and opens folders through the host.

## settings

- `app/settings/agent-toggles.js` — Auto-compaction and auto-retry toggles for General settings.
- `app/settings/appearance-preferences.js` — Appearance preferences for the dedicated Appearance settings page:
- `app/settings/appearance-settings.css` — Styles the Appearance page and the terminal preview controls.
- `app/settings/appearance-settings.js` — Settings → Appearance renders theme, chat, and preview controls.
- `app/settings/configuration-settings.js` — Settings → Advanced Configuration renders the agent text editors.
- `app/settings/container-help.js` — Short isolation help for Settings → Guard.
- `app/settings/cost-dashboard-render.js` — Renders Usage overview, model, project, and tool sections from a payload.
- `app/settings/cost-dashboard.css` — Styles the Usage page, its stat cards, and its chart canvases.
- `app/settings/cost-dashboard.js` — Loads workspace usage and paints the Usage settings page.
- `app/settings/customizations-settings.js` — Lists UI overrides with revert, a three-way view for stale files, and safe mode.
- `app/settings/dependencies/agent-browser-switch.js` — Settings switch for the bundled development browser.
- `app/settings/dependencies/dependencies-settings.js` — Settings → Dependencies lists built-in tools, npm, and Pi's browsers.
- `app/settings/dependencies/dependencies.css` — Layout for Settings → Dependencies.
- `app/settings/dependencies/dependency-row.js` — One Dependencies row: a state badge, a detail, and its actions.
- `app/settings/dependencies/install-job.js` — Shows one dependency install while it runs, then Retry or Copy log.
- `app/settings/dependencies/surf-card.js` — Guided Surf setup: install, load the extension, connect, and test.
- `app/settings/extensions-settings.js` — Settings → Packages renders installed, recommended, browse, and resources.
- `app/settings/general-settings.js` — Settings → General renders language, agent, and version rows.
- `app/settings/guard-settings.js` — Settings → General section for the permission mode.
- `app/settings/live-debug-setting.js` — Settings → General → Guard switch for "Live debugging by the model" (`ui.modelLiveDebug`, off by default).
- `app/settings/models-oauth-login.js` — Renders the owner-scoped OpenAI Codex device-code login dialog for Settings Models.
- `app/settings/models-page.js` — Mounts the Models page for providers, catalogs, and OAuth login.
- `app/settings/models-settings.js` — Settings → Models renders providers, API keys, and models.json.
- `app/settings/models/model-draft.js` — Pure helpers for one models.json model entry: copies, thinking control, images, setup results.
- `app/settings/models/model-form.js` — The model form: id, limits, Thinking, default level, images, vLLM budget, Set up model.
- `app/settings/models/model-health.js` — Model health labels, dots, and the provider health section.
- `app/settings/models/model-setup-panel.js` — Runs "Set up model" for one custom model and shows what it found as a checklist.
- `app/settings/models/oauth.js` — Models settings OAuth login, Codex logout, and the provider picker.
- `app/settings/models/provider-editor.js` — Edits one models.json provider: its fields, key, models, and the model form flow.
- `app/settings/models/provider-key-row.js` — The Key row of a custom provider: where its key comes from, plus Replace, Remove, Move.
- `app/settings/models/providers.js` — Provider rows and model lists on the Models settings page.
- `app/settings/phone-settings.js` — Settings page for phone access, pairing, and accepting the UI.
- `app/settings/projects-folder-setting.js` — Settings → General row for the folder that holds chats without a project.
- `app/settings/queue-modes.js` — Steering and follow-up delivery selects for General settings.
- `app/settings/settings-config.css` — Styles the Configuration tab's key list and inline JSON editors.
- `app/settings/settings-custom-provider.js` — Opens the custom provider editor: detect, pick models, test, save.
- `app/settings/settings-panel.css` — Styles the settings overlay, its navigation, and the shared row widgets.
- `app/settings/settings-panel.js` — Opens the settings overlay and switches its tabs.
- `app/settings/settings-save-status.js` — Shows a timed success or error next to a settings save button.
- `app/settings/terminal-settings.js` — Settings → Terminal renders shell, theme, font, scrollback, and WebGL rows.
- `app/settings/thinking-effort-control.css` — Styles the segmented thinking-effort control.
- `app/settings/usage-settings.js` — Settings → Usage embeds the cost dashboard.

## shell

- `app/shell/app-chrome.js` — Composes the workspace shell from six region components.
- `app/shell/app-launcher.css` — Styles the project launcher on the /app route.
- `app/shell/app-launcher.js` — The /app entry opens the newest saved session in the workbench, like the desktop window.
- `app/shell/app-updater.js` — Checks the release feed for an update and starts the install when asked.
- `app/shell/capabilities.js` — The only place the UI asks whether a client may show a control.
- `app/shell/chrome/chat.js` — Renders the session header and the message column.
- `app/shell/chrome/composer.js` — Renders the chat composer under the message column.
- `app/shell/chrome/file-preview.js` — Renders the editor preview column and its resize handle.
- `app/shell/chrome/file-sidebar.js` — Renders the file browser with its search box, and the git panel it hosts.
- `app/shell/chrome/side-panels.js` — Renders the session-info side panel.
- `app/shell/chrome/sidebar.js` — Renders the session sidebar and its dismiss overlay.
- `app/shell/exclusive-side-panel.js` — Opens one side panel at a time and closes the others.
- `app/shell/file-panel-shortcut.js` — Recognizes the shortcut that toggles the file sidebar.
- `app/shell/first-run.css` — Layout for the first-launch setup note.
- `app/shell/first-run.js` — First-launch note: projects folder, a model, Dependencies, and the recommended packages.
- `app/shell/header-breadcrumb.js` — Paints project, branch, and session title in the header.
- `app/shell/header-chrome.js` — Paints the header metrics and hides toggles that do not apply.
- `app/shell/header-open-app.css` — Styles the header control that opens the workspace in another app.
- `app/shell/header-open-app.js` — Opens the current workspace in another installed application.
- `app/shell/header.css` — Styles the workspace header, its pills, and the model control.
- `app/shell/layout-mode.js` — Sets body data-layout and data-pointer from one breakpoint table.
- `app/shell/layout-prefs.js` — Clamps and applies the saved sidebar, chat, and dock sizes.
- `app/shell/layout-preset.js` — Switches Workbench and Focus for the current project.
- `app/shell/mount-workbench.js` — SPOPI workbench composition: shell, dock, center tabs, packages, live chat chrome.
- `app/shell/overlay-chrome.js` — Renders the config editor and session search dialogs.
- `app/shell/panels.css` — Search, extensions, tree, context, and home-pane rows.
- `app/shell/phone-tabs.js` — Bottom tab bar for the phone layout. It only sets data-phone-region.
- `app/shell/project-header.js` — Populates the chat header with workspace path and git branch info.
- `app/shell/rail.js` — Primary rail: Sessions, Files, Review, Git; theme, Extensions, Settings actions.
- `app/shell/resizers.js` — Drags the sidebar, chat, and dock splitters and reports the new size.
- `app/shell/session-cost-bar.js` — Session cost pill and header token totals.
- `app/shell/shell-layout.js` — Wrap the SPOPI DOM into rail | sidebar | editor-over-dock | chat.
- `app/shell/shell.css` — SPOPI workbench grid: rail | sidebar | editor-over-dock | chat.
- `app/shell/spopi-commands.js` — Registers the SPOPI slash commands on the keybinding list.
- `app/shell/status-footer.css` — Extension status chips in the dock status row.
- `app/shell/status-footer.js` — Paints extension setStatus keys as chips in the dock status row.
- `app/shell/ui-reload.js` — Applies a CSS overlay reload in place and asks before a full UI reload.
- `app/shell/update-indicator.js` — Header pill that surfaces available extension package updates.

## storage

- `app/storage/cookies.js` — Synchronous cookie read and write for the first-paint appearance cache.
- `app/storage/ui-store.js` — In-memory ui.* preference cache with write-through to the host preference DB.

## styles

- `design-system.css` — Defines the shared UI primitives: buttons, dialogs, and overlays.
- `shared.css` — Holds base layout and widget classes used by more than one surface.
- `style-theme.css` — Defines the shared design tokens and one palette per theme.
- `style.css` — Rules that apply after the feature stylesheets listed in stylesheets.json.

## subagents

- `app/subagents/subagent-feed.js` — Reads pi-subagents' RPC widgets: the live run snapshot and on-demand inspect replies.
- `app/subagents/subagent-strip.js` — The row of subagents above the composer, shown only while pi-subagents reports runs.
- `app/subagents/subagent-view.js` — One subagent's conversation as a center tab, read through pi-subagents' inspect command.
- `app/subagents/subagents.css` — Styles the subagent strip above the composer and a subagent's transcript tab.

## terminal

- `app/terminal/open-in-terminal.js` — Builds the `pi -r <session>` command for the dock terminal twin.
- `app/terminal/run-file.js` — Maps a workspace file to a shell command and writes it to a live PTY.
- `app/terminal/terminal-client.js` — Owner-scoped terminal broker client: request correlation, snapshot
- `app/terminal/terminal-context.js` — Copies a terminal selection or tail into the composer as a fenced block.
- `app/terminal/terminal-font.js` — Loads SPOPI's same-origin bundled terminal font before xterm measures cells.
- `app/terminal/terminal-input-action.js` — Terminal keystrokes are a store action the Git panel can hear.
- `app/terminal/terminal-panel-integration.js` — Wires the native Host terminal protocol to the reusable terminal UI modules.
- `app/terminal/terminal-panel.css` — Styles the terminal dock panel and its toolbar.
- `app/terminal/terminal-tab.js` — One xterm.js terminal instance adapter: input/size events to client

## test-utils

- `app/test-utils/fake-adapter.js` — Test double for the host transport adapter used by preference tests.
- `app/test-utils/fake-gateway.js` — Test double for file and host gateways that record or answer calls.
- `app/test-utils/memory-storage.js` — In-memory Storage for tests and the Vitest jsdom setup.

## theme

- `app/theme/themes.js` — Applies a named theme and remembers it for the next launch.

## transport

- `app/transport/bootstrap-target.js` — Resolves the workspace and session to open when the app boots.
- `app/transport/config-gateway-readiness.js` — Signals when the config gateway can accept calls.
- `app/transport/config-gateway.js` — Sends configuration operations to the host and matches their responses.
- `app/transport/control-gateway.js` — Sends host control operations such as opening a folder or a session.
- `app/transport/data-gateway.js` — Reads files, sessions, and usage through the host data operations.
- `app/transport/oauth-gateway.js` — WebView-side session registry for Codex OAuth operations.
- `app/transport/preference-gateway.js` — Reads and writes ui.* preferences on the host.
- `app/transport/request-id.js` — Builds prefixed request ids shared by the host gateways.
- `app/transport/runtime-adapter.js` — Opens the host WebSocket and sends the desktop hello.
- `app/transport/runtime-frame-routing.js` — Sends one inbound host frame to the gateway that owns it.
- `app/transport/runtime-gateway.js` — Sends runtime mutations such as prompt and abort, and subscribes to events.
- `app/transport/workspace-http.js` — File, git, and search reads go through one host HTTP client.

## ui

- `app/ui/at-file-mention.js` — Shared @-file-mention textarea listbox controller for Main, Side, and Quick Chat.
- `app/ui/chat-follow.js` — Keeps the chat pinned to the newest line while Pi streams, for text, thinking, and tools.
- `app/ui/clipboard.js` — Copies text with the async clipboard API.
- `app/ui/context-menu.css` — Shared context menu surface. .session-context-menu stays as an alias.
- `app/ui/context-menu.js` — Fixed-position context menu shared by sessions and the file tree.
- `app/ui/context-viz.css` — Styles the context-window popover.
- `app/ui/context-viz.js` — Mounts the context-window popover and formats token counts.
- `app/ui/conv-nav.css` — Styles the conversation navigator rail.
- `app/ui/conv-nav.js` — Renders the conversation navigator and scrolls to a chosen turn.
- `app/ui/dialog.js` — Modal dialogs: overlay, focus trap, Escape, and click-outside.
- `app/ui/dom.js` — Small DOM builders shared by modules that own their markup.
- `app/ui/file-refs.js` — Turns workspace paths in chat code spans and @-mentions into preview buttons.
- `app/ui/formatters.js` — Shared byte, money, count, duration, and relative-time formatting.
- `app/ui/header-status-bar.js` — Owns the session-aggregate cost row in the header and publishes
- `app/ui/icons.js` — Provides Lucide (ISC) SVG action icons for SPOPI controls.
- `app/ui/image-lightbox.css` — Styles the image lightbox overlay.
- `app/ui/image-lightbox.js` — Opens a full-size image overlay from a chat or preview thumbnail.
- `app/ui/keybinding-help.css` — Shortcut help rows inside the existing dialog.
- `app/ui/keybinding-help.js` — Lists registered shortcuts in one dialog.
- `app/ui/keybindings.js` — One registry for SPOPI shortcuts and slash commands.
- `app/ui/layout-insets.js` — Keeps the message list padded clear of the header and the composer.
- `app/ui/loading-placeholder.js` — Shared loading placeholder: spinner icon plus localized loading text.
- `app/ui/markdown.css` — Styles rendered Markdown in chat and previews.
- `app/ui/markdown.js` — Renders Markdown for streaming text, finished messages, and user text.
- `app/ui/message-renderer.css` — Styles one chat message, its actions, and the welcome logo.
- `app/ui/message-renderer.js` — Renders user and assistant chat messages for the SPOPI WebView.
- `app/ui/popover.css` — Styles the anchored in-app popover.
- `app/ui/popover.js` — Anchored in-app popover with one open surface at a time.
- `app/ui/process-group.js` — Collapsible wrapper that folds a turn's thinking/tool-call noise into one row.
- `app/ui/resizable-panel.js` — Lets a panel be dragged to a new width or height.
- `app/ui/sanitize-markup.js` — Escapes text for HTML and strips dangerous markup from renderer output.
- `app/ui/select-menu.js` — Replaces a native select with the themed menu.
- `app/ui/settings-controls.js` — Settings row, toggle, select, and field builders for pages that render themselves.
- `app/ui/tool-card.css` — Styles tool cards with a glass surface and a colored accent.
- `app/ui/tool-card.js` — Renders collapsible tool execution cards and their streaming output.

## utils

- `app/utils/keyboard-shortcuts.js` — Registers the window-level keyboard shortcuts.
- `app/utils/load-vendor.js` — Loads heavy vendor scripts the first time a feature needs them.
- `app/utils/random-id.js` — Creates random ids and a stable per-tab host client id.
- `app/utils/router.js` — Parses and writes the /app/workspaces/.../sessions/... route.
