// ABOUTME: Classifies WebSocket frames into runtime, host, data, and the other routes.
// ABOUTME: A client hello must use protocol version 2.

use serde_json::Value;
use std::collections::HashMap;

pub const PROTOCOL_VERSION: u64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Observe,
    Control,
    Full,
}

impl Tier {
    /// The stored name; anything unknown is Control, the tier a new device gets.
    pub fn from_name(name: &str) -> Self {
        match name {
            "observe" => Self::Observe,
            "full" => Self::Full,
            _ => Self::Control,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Observe => "observe",
            Self::Control => "control",
            Self::Full => "full",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientKind {
    Desktop,
    Remote {
        device_id: String,
        name: String,
        tier: Tier,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum RoutedAction {
    Runtime {
        client_id: String,
        request_id: String,
        frame: Value,
    },
    Host {
        client_id: String,
        request_id: String,
        operation: String,
        frame: Value,
    },
    Data {
        client_id: String,
        request_id: String,
        frame: Value,
    },
    Subscribe {
        client_id: String,
        request_id: String,
        target: Value,
    },
    Terminal {
        client_id: String,
        request_id: String,
        frame: Value,
    },
    Git {
        client_id: String,
        request_id: String,
        frame: Value,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterError {
    pub code: &'static str,
    pub message: String,
}

impl RouterError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub struct HostRouter {
    clients: HashMap<String, ClientKind>,
}

impl HostRouter {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
        }
    }

    pub fn connect_as(
        &mut self,
        client_id: &str,
        hello: &Value,
        kind: ClientKind,
    ) -> Result<(), RouterError> {
        if hello.get("type").and_then(Value::as_str) != Some("hello") {
            return Err(RouterError::new(
                "handshake_required",
                "First frame must be hello",
            ));
        }
        if hello.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
            return Err(RouterError::new(
                "protocol_mismatch",
                format!(
                    "SPOPI protocol v{PROTOCOL_VERSION} is required; refresh or restart the app"
                ),
            ));
        }
        if client_id.is_empty() {
            return Err(RouterError::new(
                "invalid_client_id",
                "clientId is required",
            ));
        }
        self.clients.insert(client_id.to_owned(), kind);
        Ok(())
    }

    pub fn client_kind(&self, client_id: &str) -> Option<ClientKind> {
        self.clients.get(client_id).cloned()
    }

    pub fn route(&self, client_id: &str, frame: &Value) -> Result<RoutedAction, RouterError> {
        let kind = self.client_kind(client_id).ok_or_else(|| {
            RouterError::new("unauthorized_client", "Client has not completed handshake")
        })?;
        let frame_type = frame
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| RouterError::new("invalid_frame", "Frame type is required"))?;
        let request_id = frame
            .get("requestId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| RouterError::new("invalid_frame", "requestId is required"))?
            .to_owned();

        let action = match frame_type {
            "git_command" | "git_ai_commit_message" => {
                if frame.get("workspaceId").and_then(Value::as_str).is_none() {
                    return Err(RouterError::new(
                        "invalid_git_command",
                        "workspaceId is required",
                    ));
                }
                Ok(RoutedAction::Git {
                    client_id: client_id.to_owned(),
                    request_id,
                    frame: frame.clone(),
                })
            }
            "terminal_command" => {
                if frame.get("workspaceId").and_then(Value::as_str).is_none()
                    || !frame.get("payload").is_some_and(Value::is_object)
                {
                    return Err(RouterError::new(
                        "invalid_terminal_command",
                        "workspaceId and payload are required",
                    ));
                }
                Ok(RoutedAction::Terminal {
                    client_id: client_id.to_owned(),
                    request_id,
                    frame: frame.clone(),
                })
            }
            "runtime_subscribe" => {
                let target = frame.get("target").cloned().ok_or_else(|| {
                    RouterError::new("invalid_target", "Runtime target is required")
                })?;
                validate_target(&target)?;
                Ok(RoutedAction::Subscribe {
                    client_id: client_id.to_owned(),
                    request_id,
                    target,
                })
            }
            "runtime_request"
            | "runtime_snapshot_request"
            | "runtime_capabilities_request"
            | "runtime_rebind_session_request" => {
                if frame_type == "runtime_request" {
                    validate_runtime_request(frame)?;
                }
                if frame_type == "runtime_rebind_session_request" {
                    let target = frame.get("target").ok_or_else(|| {
                        RouterError::new("invalid_target", "Runtime target is required")
                    })?;
                    validate_target(target)?;
                    if frame
                        .get("newSessionId")
                        .and_then(Value::as_str)
                        .filter(|id| !id.is_empty())
                        .is_none()
                    {
                        return Err(RouterError::new(
                            "invalid_session_id",
                            "newSessionId is required",
                        ));
                    }
                }
                Ok(RoutedAction::Runtime {
                    client_id: client_id.to_owned(),
                    request_id,
                    frame: frame.clone(),
                })
            }
            "host_request" => {
                let operation =
                    frame
                        .get("operation")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            RouterError::new("invalid_host_request", "operation is required")
                        })?;
                Ok(RoutedAction::Host {
                    client_id: client_id.to_owned(),
                    request_id,
                    operation: operation.to_owned(),
                    frame: frame.clone(),
                })
            }
            "data_request" => Ok(RoutedAction::Data {
                client_id: client_id.to_owned(),
                request_id,
                frame: frame.clone(),
            }),
            _ => Err(RouterError::new(
                "unknown_frame_type",
                "Unsupported protocol v2 frame type",
            )),
        }?;
        if !crate::host::capabilities::allowed(&kind, &action) {
            return Err(RouterError::new(
                "not_allowed",
                "This device cannot run that action",
            ));
        }
        Ok(action)
    }
}

fn validate_runtime_request(frame: &Value) -> Result<(), RouterError> {
    let target = frame
        .get("target")
        .ok_or_else(|| RouterError::new("invalid_target", "Runtime target is required"))?;
    validate_target(target)?;
    let command_type = frame
        .get("command")
        .and_then(|command| command.get("type"))
        .and_then(Value::as_str)
        .ok_or_else(|| RouterError::new("invalid_command", "Runtime command type is required"))?;
    if is_mutation(command_type)
        && frame
            .get("idempotencyKey")
            .and_then(Value::as_str)
            .filter(|key| !key.is_empty())
            .is_none()
    {
        return Err(RouterError::new(
            "idempotency_key_required",
            "Runtime mutations require idempotencyKey",
        ));
    }
    Ok(())
}

fn validate_target(target: &Value) -> Result<(), RouterError> {
    let target = target
        .as_object()
        .ok_or_else(|| RouterError::new("invalid_target", "Runtime target must be an object"))?;
    for field in ["workspaceId", "sessionId", "instanceId"] {
        if target.get(field).and_then(Value::as_str).is_none() {
            return Err(RouterError::new(
                "invalid_target",
                format!("{field} is required"),
            ));
        }
    }
    Ok(())
}

fn is_mutation(command_type: &str) -> bool {
    matches!(
        command_type,
        "prompt"
            | "steer"
            | "follow_up"
            | "compact"
            | "bash"
            | "fork"
            | "clone"
            | "set_model"
            | "set_thinking_level"
            | "set_auto_compaction"
            | "set_auto_retry"
            | "set_steering_mode"
            | "set_follow_up_mode"
    )
}

#[cfg(test)]
mod tests {
    use super::{ClientKind, HostRouter, RoutedAction, Tier, PROTOCOL_VERSION};
    use serde_json::json;

    #[test]
    fn a_stored_tier_name_reads_back_and_an_unknown_one_is_control() {
        for tier in [Tier::Observe, Tier::Control, Tier::Full] {
            assert_eq!(Tier::from_name(tier.name()), tier);
        }
        assert_eq!(Tier::from_name("admin"), Tier::Control);
        assert_eq!(Tier::from_name(""), Tier::Control);
    }

    fn connect_desktop(router: &mut HostRouter, client_id: &str) {
        router
            .connect_as(
                client_id,
                &json!({
                    "type": "hello",
                    "protocolVersion": PROTOCOL_VERSION,
                    "clientType": "desktop",
                }),
                ClientKind::Desktop,
            )
            .unwrap();
    }

    #[test]
    fn requires_an_exact_v2_handshake() {
        let mut router = HostRouter::new();
        assert!(router
            .connect_as(
                "client-a",
                &json!({ "type": "hello", "protocolVersion": 1, "clientType": "desktop" }),
                ClientKind::Desktop,
            )
            .is_err());
        connect_desktop(&mut router, "client-a");
        assert_eq!(router.client_kind("client-a"), Some(ClientKind::Desktop));
    }

    #[test]
    fn legacy_auth_frames_are_not_routable() {
        let mut router = HostRouter::new();
        connect_desktop(&mut router, "desktop");
        let error = router
            .route(
                "desktop",
                &json!({
                    "type": "auth_request",
                    "requestId": "auth-1",
                }),
            )
            .unwrap_err();
        assert_eq!(error.code, "unknown_frame_type");
    }

    #[test]
    fn keeps_runtime_and_host_routes_separate() {
        let mut router = HostRouter::new();
        connect_desktop(&mut router, "desktop");
        let runtime = router
            .route(
                "desktop",
                &json!({
                    "type": "runtime_request",
                    "requestId": "request-1",
                    "idempotencyKey": "intent-1",
                    "target": {
                        "workspaceId": "workspace-a",
                        "sessionId": "session-a",
                        "instanceId": "instance-a"
                    },
                    "command": { "type": "prompt", "message": "secret" }
                }),
            )
            .unwrap();
        assert!(matches!(runtime, RoutedAction::Runtime { .. }));

        let host = router
            .route(
                "desktop",
                &json!({
                    "type": "host_request",
                    "requestId": "request-2",
                    "operation": "pick_folder"
                }),
            )
            .unwrap();
        assert!(matches!(host, RoutedAction::Host { .. }));
    }

    #[test]
    fn routes_terminal_commands_for_desktop_clients() {
        let mut router = HostRouter::new();
        connect_desktop(&mut router, "window");
        let command = json!({
            "type": "terminal_command",
            "requestId": "terminal-1",
            "workspaceId": "workspace-a",
            "payload": { "type": "terminal_list" },
        });
        assert!(matches!(
            router.route("window", &command),
            Ok(RoutedAction::Terminal { .. })
        ));
    }

    #[test]
    fn routes_a_well_formed_rebind_session_request_and_rejects_a_missing_new_session_id() {
        let mut router = HostRouter::new();
        connect_desktop(&mut router, "desktop");
        let target = json!({
            "workspaceId": "workspace-a",
            "sessionId": "session-a",
            "instanceId": "instance-a"
        });
        let routed = router
            .route(
                "desktop",
                &json!({
                    "type": "runtime_rebind_session_request",
                    "requestId": "request-1",
                    "target": target,
                    "newSessionId": "session-b",
                }),
            )
            .unwrap();
        assert!(matches!(routed, RoutedAction::Runtime { .. }));

        let missing_new_id = router.route(
            "desktop",
            &json!({
                "type": "runtime_rebind_session_request",
                "requestId": "request-2",
                "target": target,
            }),
        );
        assert!(missing_new_id.is_err());
    }
}
