# RPC coverage

Every Pi RPC command and event is listed once. `handled` means the path contains the name. `unused` is a Pi name this GUI does not call. `forbidden` is rejected because the host owns session identity.

| name | kind | status | where | reason |
| --- | --- | --- | --- | --- |
| prompt | command | handled | public/app/session/session-runtime.js | Sends the user message. |
| steer | command | handled | public/app/chat/stop-run.js | Queues a steering message. |
| follow_up | command | handled | public/app/chat/stop-run.js | Queues a follow-up message. |
| abort | command | handled | public/app/session/session-runtime.js | Stops the current turn. |
| clear_queue | command | handled | public/app/chat/stop-run.js | Drops queued steering and follow-ups. |
| new_session | command | forbidden | src-tauri/src/pi/coordinator.rs | The host owns session identity. |
| get_state | command | handled | src-tauri/src/host/server/ws/route.rs | Snapshot requests read the live session. |
| set_model | command | handled | public/app/composer/model-controls.js | Selects the provider and model. |
| cycle_model | command | handled | public/app/composer/model-controls.js | Ctrl+Alt+M cycles the composer model. |
| get_available_models | command | handled | public/app/composer/model-controls.js | Fills the model menu. |
| set_thinking_level | command | handled | public/app/settings/general-settings.js | Sets the thinking level. |
| cycle_thinking_level | command | handled | public/app/session/session-runtime.js | Cycles the thinking level. |
| get_available_thinking_levels | command | handled | public/app/settings/general-settings.js | Lists thinking levels. |
| set_steering_mode | command | handled | public/app/settings/queue-modes.js | Settings writes the live session and the default. |
| set_follow_up_mode | command | handled | public/app/settings/queue-modes.js | Settings writes the live session and the default. |
| compact | command | handled | public/app/transport/runtime-gateway.js | The gateway accepts a compaction command. |
| set_auto_compaction | command | handled | public/app/settings/agent-toggles.js | Settings writes the live session and the default. |
| set_auto_retry | command | handled | public/app/settings/agent-toggles.js | Settings writes the live session and the default. |
| abort_retry | command | handled | public/app/chat/mount-history.js | The retry banner abort stops the delay. |
| bash | command | unused | | The dock terminal is separate. |
| abort_bash | command | handled | public/app/chat/stop-run.js | Stops a running bash tool. |
| get_session_stats | command | handled | public/app/shell/session-cost-bar.js | Reads token and cost totals. |
| export_html | command | handled | public/app/session/session-export.js | Writes the session HTML and reveals the file. |
| switch_session | command | forbidden | src-tauri/src/pi/coordinator.rs | The host owns session identity. |
| fork | command | handled | public/app/session/session-runtime.js | Forks from an entry. |
| clone | command | handled | public/app/transport/runtime-gateway.js | The gateway accepts a clone mutation. |
| get_fork_messages | command | handled | public/app/session/message-fork.js | Loads messages for a fork. |
| get_entries | command | handled | public/app/session/session-tree-host.js | Resyncs entries after the last id. |
| get_tree | command | handled | public/app/session/session-tree-host.js | Loads the session tree. |
| get_last_assistant_text | command | unused | | The transcript holds the assistant text. |
| set_session_name | command | handled | public/app/session/session-sidebar.js | Renames the session. |
| get_messages | command | unused | | The snapshot plus get_entries cover it. |
| get_commands | command | handled | public/app/session/session-runtime.js | Lists slash commands. |
| agent_start | event | handled | public/app/chat/transcript-reducer.js | The reducer starts a turn. |
| agent_end | event | handled | public/app/chat/transcript-reducer.js | The reducer records the end of a run. |
| turn_start | event | handled | public/app/metrics/metrics-model.js | Cockpit turn rows open here. |
| turn_end | event | handled | public/app/metrics/metrics-model.js | Cockpit turn rows close here. |
| message_start | event | handled | public/app/chat/transcript-reducer.js | The reducer opens a message. |
| message_update | event | handled | public/app/chat/transcript-reducer.js | The reducer applies stream deltas. |
| message_end | event | handled | public/app/chat/transcript-reducer.js | The reducer closes a message. |
| tool_execution_start | event | handled | public/app/chat/transcript-reducer.js | The reducer opens a tool call. |
| tool_execution_update | event | handled | public/app/chat/transcript-reducer.js | The reducer updates a tool call. |
| tool_execution_end | event | handled | public/app/chat/transcript-reducer.js | The reducer closes a tool call. |
| agent_settled | event | handled | public/app/chat/transcript-reducer.js | The reducer marks the turn idle. |
| queue_update | event | handled | public/app/chat/transcript-reducer.js | The reducer stores the queue. |
| compaction_start | event | handled | public/app/chat/transcript-reducer.js | The reducer marks compaction. |
| compaction_end | event | handled | public/app/chat/transcript-reducer.js | The reducer finishes compaction. |
| entry_appended | event | handled | public/app/chat/runtime-events.js | The tree model appends the entry. |
| session_info_changed | event | handled | public/app/chat/transcript-reducer.js | The reducer stores the session name. |
| thinking_level_changed | event | handled | public/app/chat/runtime-events.js | The composer chip follows the event. |
| auto_retry_start | event | handled | public/app/chat/transcript-reducer.js | The reducer marks a retry. |
| auto_retry_end | event | handled | public/app/chat/transcript-reducer.js | The reducer finishes a retry. |
| summarization_retry_scheduled | event | handled | public/app/chat/transcript-reducer.js | The reducer shows the retry delay. |
| summarization_retry_attempt_start | event | handled | public/app/chat/transcript-reducer.js | The reducer shows the retry attempt. |
| summarization_retry_finished | event | handled | public/app/chat/transcript-reducer.js | The reducer clears the retry note. |
| bash_execution_update | event | unused | | No RPC bash. |
| extension_error | event | handled | public/app/chat/transcript-reducer.js | The reducer records an extension error. |
