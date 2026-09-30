// ABOUTME: Builds the cost dashboard and classifies files for preview.
// ABOUTME: Session JSONL parsing lives in session_format.rs.

use super::*;
use std::path::Component;

pub(crate) fn build_cost_dashboard(sessions: Vec<SessionMetrics>) -> CostDashboard {
    let mut dashboard = CostDashboard::default();
    let mut by_model: Vec<(String, f64)> = Vec::new();
    let mut by_tool: HashMap<String, f64> = HashMap::new();
    for session in &sessions {
        dashboard.summary.total_cost += session.total_cost;
        let session_tokens =
            session.input_tokens + session.output_tokens + session.cache_read + session.cache_write;
        dashboard.summary.total_tokens += session_tokens;
        dashboard.summary.user_message_count += session.user_messages;
        dashboard.summary.session_count += 1;

        match by_model.iter_mut().find(|(name, _)| name == &session.model) {
            Some((_, cost)) => *cost += session.total_cost,
            None => by_model.push((session.model.clone(), session.total_cost)),
        }
        for (tool_name, cost) in &session.tool_cost_by_name {
            *by_tool.entry(tool_name.clone()).or_insert(0.0) += cost;
        }
    }
    dashboard.summary.avg_cost_per_session = if dashboard.summary.session_count > 0 {
        dashboard.summary.total_cost / dashboard.summary.session_count as f64
    } else {
        0.0
    };
    dashboard.summary.avg_cost_per_user_message = if dashboard.summary.user_message_count > 0 {
        dashboard.summary.total_cost / dashboard.summary.user_message_count as f64
    } else {
        0.0
    };
    by_model.sort_by(|left, right| right.1.total_cmp(&left.1));
    dashboard.by_model = by_model
        .into_iter()
        .map(|(name, cost)| CostBreakdownEntry { name, cost })
        .collect();
    let mut by_tool: Vec<(String, f64)> = by_tool.into_iter().collect();
    by_tool.sort_by(|left, right| right.1.total_cmp(&left.1));
    dashboard.by_tool = by_tool
        .into_iter()
        .map(|(name, cost)| CostBreakdownEntry { name, cost })
        .collect();

    let mut session_rows: Vec<CostSessionRow> = sessions
        .into_iter()
        .map(|session| {
            let project_path = session
                .cwd
                .as_ref()
                .map(|cwd| cwd.to_string_lossy().into_owned())
                .unwrap_or_default();
            let project_name = session
                .cwd
                .as_ref()
                .and_then(|cwd| cwd.file_name())
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| project_path.clone());
            CostSessionRow {
                id: session.id,
                title: session.title,
                model: session.model,
                time: session.timestamp,
                total_cost: session.total_cost,
                total_tokens: session.input_tokens
                    + session.output_tokens
                    + session.cache_read
                    + session.cache_write,
                input_tokens: session.input_tokens,
                output_tokens: session.output_tokens,
                cache_read: session.cache_read,
                cache_write: session.cache_write,
                tool_calls: session.tool_calls,
                tool_cost_by_name: session.tool_cost_by_name,
                user_messages: session.user_messages,
                project_path,
                project_name,
            }
        })
        .collect();
    session_rows.sort_by(|left, right| right.total_cost.total_cmp(&left.total_cost));
    dashboard.top_sessions = session_rows.iter().take(20).cloned().collect();
    dashboard.sessions = session_rows;
    dashboard
}

/// Compare two directories, preferring canonicalized equality but falling back
/// to a raw path comparison when a directory no longer exists on disk (so
/// sessions belonging to deleted projects still group correctly).
pub(crate) fn same_dir(left: &Path, right: &Path) -> bool {
    match (
        super::paths::canonical_path(left),
        super::paths::canonical_path(right),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => left == right,
    }
}

pub(crate) const TEXT_READ_LIMIT: usize = 2 * 1024 * 1024;
pub(crate) const EDIT_SIZE_LIMIT: usize = 1024 * 1024;
pub(crate) const BINARY_PREFIX_BYTES: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PreviewFileKind {
    Text,
    Image,
    Pdf,
    Binary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PreviewFileClassification {
    pub(crate) mime_type: &'static str,
    pub(crate) kind: PreviewFileKind,
    pub(crate) editable: bool,
}

pub(crate) fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf, HostDataError> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return Err(HostDataError::InvalidRelativePath);
    }
    let joined = root.join(relative);
    let canonical = super::paths::canonical_path(&joined)
        .map_err(|error| HostDataError::Io(error.to_string()))?;
    if !canonical.starts_with(root) {
        return Err(HostDataError::OutsideWorkspace);
    }
    Ok(canonical)
}

pub(crate) fn file_mtime_ms(metadata: &std::fs::Metadata) -> Result<f64, HostDataError> {
    let modified = metadata
        .modified()
        .map_err(|error| HostDataError::Io(error.to_string()))?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| HostDataError::Io(error.to_string()))?;
    Ok(duration.as_secs_f64() * 1000.0)
}

pub(crate) fn preview_extension(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| {
            name.rsplit_once('.')
                .map(|(_, ext)| ext.to_ascii_lowercase())
        })
        .unwrap_or_default()
}

pub(crate) fn is_binary_by_prefix(prefix: &[u8]) -> bool {
    prefix
        .iter()
        .take(BINARY_PREFIX_BYTES)
        .any(|byte| *byte == 0)
}

pub(crate) fn classify_preview_file(path: &Path, prefix: &[u8]) -> PreviewFileClassification {
    let ext = preview_extension(path);
    if ext == "pdf" || prefix.starts_with(b"%PDF") {
        return PreviewFileClassification {
            mime_type: "application/pdf",
            kind: PreviewFileKind::Pdf,
            editable: false,
        };
    }
    if let Some(mime_type) = image_mime_type(&ext) {
        return PreviewFileClassification {
            mime_type,
            kind: PreviewFileKind::Image,
            editable: false,
        };
    }
    if ext == "mbox" || is_convertible_suffix(&ext) {
        return PreviewFileClassification {
            mime_type: "application/octet-stream",
            kind: PreviewFileKind::Binary,
            editable: false,
        };
    }
    if is_binary_by_prefix(prefix) {
        return PreviewFileClassification {
            mime_type: "application/octet-stream",
            kind: PreviewFileKind::Binary,
            editable: false,
        };
    }
    PreviewFileClassification {
        mime_type: text_mime_type(&ext),
        kind: PreviewFileKind::Text,
        editable: true,
    }
}

pub(crate) fn image_mime_type(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

pub(crate) fn text_mime_type(ext: &str) -> &'static str {
    match ext {
        "js" | "jsx" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" | "mts" | "cts" => "text/typescript",
        "json" | "jsonc" => "application/json",
        "yaml" | "yml" => "text/yaml",
        "toml" => "application/toml",
        "xml" => "text/xml",
        "html" | "htm" => "text/html",
        "css" | "scss" | "sass" | "less" => "text/css",
        "md" | "markdown" | "mdown" | "mkd" => "text/markdown",
        "py" | "pyw" | "pyi" => "text/x-python",
        "r" => "text/x-r-source",
        "rb" => "text/x-ruby",
        "go" => "text/x-go",
        "rs" => "text/x-rust",
        "c" | "h" => "text/x-c",
        "cpp" | "hpp" | "cc" => "text/x-c++",
        "sh" | "bash" | "zsh" => "application/x-sh",
        "sql" => "application/sql",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "log" | "env" | "conf" | "ini" | "cfg" => "text/plain",
        "diff" | "patch" => "text/x-diff",
        _ => "text/plain",
    }
}
