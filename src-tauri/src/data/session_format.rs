// ABOUTME: Parses Pi session JSONL into metrics, summaries, and message text.
// ABOUTME: Search and the cost dashboard call this module. It does not walk files.

use super::*;

/// Lines of a session file. A line that is not UTF-8 is skipped (the reader has
/// consumed it); any other read error ends the file, because `lines()` repeats
/// it forever (for example a directory named `*.jsonl` on Linux and macOS).
fn session_lines(file: std::fs::File) -> impl Iterator<Item = String> {
    BufReader::new(file)
        .lines()
        .map_while(|line| match line {
            Ok(line) => Some(Some(line)),
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => Some(None),
            Err(_) => None,
        })
        .flatten()
}

/// Every JSONL entry Pi writes: session header, message, thinking_level_change,
/// model_change, usage, compaction, branch_summary, custom, custom_message,
/// context_edit, label, and session_info. Callers interpret the values.
pub(crate) fn read_jsonl_entries(path: &Path) -> Result<Vec<serde_json::Value>, HostDataError> {
    let file = std::fs::File::open(path).map_err(|error| HostDataError::Io(error.to_string()))?;
    let mut entries = Vec::new();
    for line in session_lines(file) {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        entries.push(entry);
    }
    Ok(entries)
}

fn accumulate_usage(metrics: &mut SessionMetrics, usage: Option<&serde_json::Value>) {
    let cost = usage
        .and_then(|usage| usage.pointer("/cost/total"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);
    metrics.total_cost += cost;
    metrics.input_tokens += usage
        .and_then(|usage| usage.get("input"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    metrics.output_tokens += usage
        .and_then(|usage| usage.get("output"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    metrics.cache_read += usage
        .and_then(|usage| usage.get("cacheRead"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    metrics.cache_write += usage
        .and_then(|usage| usage.get("cacheWrite"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
}

pub(crate) fn parse_session_metrics(
    path: &Path,
    workspace: Option<&Path>,
) -> Result<Option<SessionMetrics>, HostDataError> {
    let file = std::fs::File::open(path).map_err(|error| HostDataError::Io(error.to_string()))?;
    let mut metrics = SessionMetrics {
        model: "unknown".to_owned(),
        ..SessionMetrics::default()
    };
    for line in session_lines(file) {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match entry.get("type").and_then(serde_json::Value::as_str) {
            Some("session") => {
                metrics.id = entry
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                metrics.timestamp = entry
                    .get("timestamp")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                metrics.cwd = entry
                    .get("cwd")
                    .and_then(serde_json::Value::as_str)
                    .map(PathBuf::from);
            }
            Some("session_info") => {
                if let Some(name) = entry.get("name").and_then(serde_json::Value::as_str) {
                    metrics.title = name.to_owned();
                }
            }
            Some("model_change") => {
                if let Some(model) = entry.get("model").and_then(serde_json::Value::as_str) {
                    metrics.model = model.to_owned();
                }
            }
            Some("message") => {
                let Some(role) = entry
                    .pointer("/message/role")
                    .and_then(serde_json::Value::as_str)
                else {
                    continue;
                };
                if role == "user" {
                    metrics.user_messages += 1;
                    continue;
                }
                if role != "assistant" {
                    continue;
                }
                if let Some(model) = entry
                    .pointer("/message/model")
                    .and_then(serde_json::Value::as_str)
                {
                    metrics.model = model.to_owned();
                }
                let usage = entry.pointer("/message/usage");
                let cost = usage
                    .and_then(|usage| usage.pointer("/cost/total"))
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(0.0);
                metrics.total_cost += cost;
                metrics.input_tokens += usage
                    .and_then(|usage| usage.get("input"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                metrics.output_tokens += usage
                    .and_then(|usage| usage.get("output"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                metrics.cache_read += usage
                    .and_then(|usage| usage.get("cacheRead"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                metrics.cache_write += usage
                    .and_then(|usage| usage.get("cacheWrite"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                let tool_calls: Vec<&str> = entry
                    .pointer("/message/content")
                    .and_then(serde_json::Value::as_array)
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|block| {
                                block.get("type").and_then(serde_json::Value::as_str)
                                    == Some("toolCall")
                            })
                            .filter_map(|block| {
                                block.get("name").and_then(serde_json::Value::as_str)
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                metrics.tool_calls += tool_calls.len() as u64;
                if !tool_calls.is_empty() && cost > 0.0 {
                    let per_tool_cost = cost / tool_calls.len() as f64;
                    for tool_name in tool_calls {
                        *metrics
                            .tool_cost_by_name
                            .entry(tool_name.to_owned())
                            .or_insert(0.0) += per_tool_cost;
                    }
                }
            }
            Some("usage") => {
                accumulate_usage(&mut metrics, entry.get("usage"));
                if metrics.model == "unknown" {
                    if let Some(model) = entry.get("model").and_then(serde_json::Value::as_str) {
                        metrics.model = model.to_owned();
                    }
                }
            }
            _ => {}
        }
    }
    if metrics.id.is_empty() {
        return Ok(None);
    }
    if let Some(workspace) = workspace {
        let Some(cwd) = metrics.cwd.as_ref() else {
            return Ok(None);
        };
        if !same_dir(cwd, workspace) {
            return Ok(None);
        }
    }
    if metrics.title.is_empty() {
        metrics.title = "Untitled".to_owned();
    }
    Ok(Some(metrics))
}

/// Parse a session file into a summary. `project_path` is populated from the
/// session's `cwd` (its originating project); `workspace_id` /
/// `is_current_workspace` are left empty here and filled in by the caller,
/// which knows the workspace the sidebar is showing.
pub(crate) fn parse_session_id(path: &Path) -> Result<Option<String>, HostDataError> {
    let file = std::fs::File::open(path).map_err(|error| HostDataError::Io(error.to_string()))?;
    for line in session_lines(file) {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if entry.get("type").and_then(serde_json::Value::as_str) == Some("session") {
            return Ok(entry
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned));
        }
    }
    Ok(None)
}

pub(crate) fn metadata_modified_at_ms(metadata: &std::fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis())
}

pub(crate) fn timestamp_value_ms(value: Option<&serde_json::Value>) -> Option<u128> {
    match value? {
        serde_json::Value::Number(number) => number.as_u64().map(u128::from),
        serde_json::Value::String(text) => iso_timestamp_ms(text),
        _ => None,
    }
}

pub(crate) fn iso_timestamp_ms(text: &str) -> Option<u128> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (date, time) = trimmed.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;
    if date_parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let time = time.strip_suffix('Z').unwrap_or(time);
    if time.contains('+') || time.rmatch_indices('-').any(|(index, _)| index > 0) {
        return None;
    }
    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<u32>().ok()?;
    let minute = time_parts.next()?.parse::<u32>().ok()?;
    let second_text = time_parts.next()?;
    if time_parts.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    let (second_whole, fraction) = second_text
        .split_once('.')
        .map_or((second_text, ""), |(whole, fraction)| (whole, fraction));
    let second = second_whole.parse::<u32>().ok()?;
    if second > 59 {
        return None;
    }
    let millis = fraction
        .chars()
        .take(3)
        .try_fold((0_u32, 0_u32), |(value, digits), ch| {
            ch.to_digit(10)
                .map(|digit| (value * 10 + digit, digits + 1))
        })
        .map(|(value, digits)| value * 10_u32.pow(3 - digits))
        .unwrap_or(0);

    let days = days_from_civil(year, month, day)?;
    Some(
        days as u128 * 86_400_000
            + hour as u128 * 3_600_000
            + minute as u128 * 60_000
            + second as u128 * 1_000
            + millis as u128,
    )
}

// Howard Hinnant's days-from-civil algorithm. Returns days since 1970-01-01.
pub(crate) fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    let year = year - i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i32;
    let day = day as i32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era as i64 * 146_097 + doe as i64 - 719_468;
    (days >= 0).then_some(days)
}

pub(crate) fn parse_session_summary_with_metadata(
    path: &Path,
    modified_at_ms: u128,
) -> Result<Option<SessionSummary>, HostDataError> {
    let file = std::fs::File::open(path).map_err(|error| HostDataError::Io(error.to_string()))?;
    let mut id = None;
    let mut timestamp = String::new();
    let mut cwd = None;
    let mut name = None;
    let mut first_message = None;
    let mut last_user_message_at_ms = None;
    let mut user_message_count = 0;
    let mut line_count = 0;
    for line in session_lines(file) {
        if line.trim().is_empty() {
            continue;
        }
        line_count += 1;
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match entry.get("type").and_then(serde_json::Value::as_str) {
            Some("session") => {
                id = entry
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
                timestamp = entry
                    .get("timestamp")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                cwd = entry
                    .get("cwd")
                    .and_then(serde_json::Value::as_str)
                    .map(PathBuf::from);
            }
            Some("session_info") => {
                name = entry
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
            }
            Some("message")
                if entry
                    .pointer("/message/role")
                    .and_then(serde_json::Value::as_str)
                    == Some("user") =>
            {
                user_message_count += 1;
                last_user_message_at_ms = timestamp_value_ms(
                    entry
                        .pointer("/message/timestamp")
                        .or_else(|| entry.get("timestamp")),
                )
                .or(last_user_message_at_ms);
                if first_message.is_none() {
                    first_message = message_text(entry.pointer("/message/content"))
                        .map(|text| text.chars().take(120).collect());
                }
            }
            _ => {}
        }
        // The session display name (`session_info`) is appended at the end of the
        // file when the agent settles. Do not break early until we've read it,
        // otherwise every session over 50 lines shows the first message instead
        // of its name. Only stop once both `first_message` and `name` are known.
        if line_count > 50 && first_message.is_some() && name.is_some() {
            break;
        }
    }
    let Some(id) = id else { return Ok(None) };
    if user_message_count == 0 && line_count <= 4 && name.as_deref() != Some("Agent Inbox") {
        return Ok(None);
    }
    let Some(cwd) = cwd else {
        return Ok(None);
    };
    let project_path = crate::data::paths::canonical_path(&cwd).unwrap_or(cwd);
    let project_name = project_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| project_path.to_string_lossy().into_owned());
    let activity_at_ms = last_user_message_at_ms
        .or_else(|| iso_timestamp_ms(&timestamp))
        .unwrap_or(modified_at_ms);
    Ok(Some(SessionSummary {
        id,
        timestamp,
        name,
        first_message,
        workspace_id: String::new(),
        project_path: project_path.to_string_lossy().into_owned(),
        project_name,
        is_current_workspace: false,
        file_path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        modified_at_ms,
        activity_at_ms,
        worktree_of: None,
    }))
}

pub(crate) fn message_text(content: Option<&serde_json::Value>) -> Option<String> {
    match content? {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .find(|block| block.get("type").and_then(serde_json::Value::as_str) == Some("text"))
            .and_then(|block| block.get("text"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        _ => None,
    }
}
