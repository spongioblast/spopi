// ABOUTME: One host-operation error type: a stable code plus a message.
// ABOUTME: HostDataError and the old (code, message) tuple convert into it.

use crate::data::HostDataError;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OpError {
    pub code: &'static str,
    pub message: String,
}

impl OpError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<(&'static str, String)> for OpError {
    fn from((code, message): (&'static str, String)) -> Self {
        Self { code, message }
    }
}

impl From<HostDataError> for OpError {
    fn from(error: HostDataError) -> Self {
        match error {
            HostDataError::UnknownWorkspace => {
                Self::new("workspace_not_found", "Workspace is not registered")
            }
            HostDataError::InvalidRelativePath | HostDataError::OutsideWorkspace => Self::new(
                "path_outside_workspace",
                "Requested path is outside the registered workspace",
            ),
            HostDataError::NotDirectory => {
                Self::new("not_a_directory", "Requested path is not a directory")
            }
            HostDataError::NotFile => Self::new("not_a_file", "Requested path is not a file"),
            HostDataError::InvalidMentionQuery => {
                Self::new("invalid_mention_query", "File mention query is invalid")
            }
            HostDataError::Io(message) => Self::new("file_access_failed", message),
        }
    }
}

pub(crate) fn host_ok(value: Value) -> Result<Value, OpError> {
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{host_ok, OpError};
    use crate::data::HostDataError;
    use serde_json::json;

    #[test]
    fn tuple_and_host_data_convert() {
        let from_tuple = OpError::from(("invalid_path", "missing".into()));
        assert_eq!(from_tuple.code, "invalid_path");
        assert_eq!(from_tuple.message, "missing");
        let from_data = OpError::from(HostDataError::UnknownWorkspace);
        assert_eq!(from_data.code, "workspace_not_found");
        assert_eq!(host_ok(json!({"ok": true})).unwrap()["ok"], true);
    }
}
