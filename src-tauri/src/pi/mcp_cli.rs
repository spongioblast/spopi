// ABOUTME: Builds `pi mcp` arguments and parses `pi mcp list --json`.
// ABOUTME: It never writes mcp.json; the bundled pi binary does.

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpScope {
    Global,
    Project,
}

pub fn scope_args(scope: McpScope) -> Vec<String> {
    match scope {
        McpScope::Global => Vec::new(),
        McpScope::Project => vec!["--local".to_string()],
    }
}

pub fn parse_scope(scope: &str) -> Result<McpScope, String> {
    match scope {
        "global" => Ok(McpScope::Global),
        "project" => Ok(McpScope::Project),
        other => Err(format!(
            "scope must be \"global\" or \"project\", got \"{other}\""
        )),
    }
}

/// Pi's server names: letters, digits, `_`, and `-`, 1 to 64 characters.
pub fn validate_server_name(name: &str) -> Result<(), String> {
    let ok = (1..=64).contains(&name.len())
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');
    if ok {
        Ok(())
    } else {
        Err(format!(
            "invalid server name \"{name}\" (use letters, digits, \"_\" and \"-\", 1–64 characters)"
        ))
    }
}

const EXPOSURES: [&str; 4] = ["codemode", "deferred", "direct", "hidden"];

/// The `spec` object from an `add_mcp_server` frame. JSON fields are camelCase.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpAddSpec {
    pub name: String,
    pub scope: String,
    pub kind: String,
    pub exposure: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub bearer_token_env_var: Option<String>,
    #[serde(default)]
    pub oauth_client_id: Option<String>,
    #[serde(default)]
    pub oauth_client_secret: Option<String>,
    #[serde(default)]
    pub oauth_callback_port: Option<u16>,
    #[serde(default)]
    pub oauth_client_name: Option<String>,
}

fn env_key_ok(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {
            chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        }
        _ => false,
    }
}

fn push_opt(args: &mut Vec<String>, flag: &str, value: &Option<String>) {
    if let Some(value) = value
        .as_ref()
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
    {
        args.push(flag.to_string());
        args.push(value.to_string());
    }
}

/// `pi mcp add` argv. Stdio always puts `--` before the command, so an
/// argument that looks like a flag stays an argument.
pub fn add_args(spec: &McpAddSpec) -> Result<Vec<String>, String> {
    validate_server_name(&spec.name)?;
    let scope = parse_scope(&spec.scope)?;
    if let Some(exposure) = spec
        .exposure
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        if !EXPOSURES.contains(&exposure) {
            return Err(format!(
                "exposure must be one of {}, got \"{exposure}\"",
                EXPOSURES.join(", ")
            ));
        }
    }
    let mut args = vec!["mcp".to_string(), "add".to_string(), spec.name.clone()];
    args.extend(scope_args(scope));
    if let Some(exposure) = spec
        .exposure
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        args.push("--exposure".to_string());
        args.push(exposure.to_string());
    }
    push_opt(&mut args, "--description", &spec.description);
    match spec.kind.as_str() {
        "stdio" => push_stdio(&mut args, spec)?,
        "http" => push_http(&mut args, spec)?,
        other => {
            return Err(format!(
                "kind must be \"stdio\" or \"http\", got \"{other}\""
            ))
        }
    }
    Ok(args)
}

fn stdio_fields_set(spec: &McpAddSpec) -> bool {
    spec.command.as_ref().is_some_and(|c| !c.trim().is_empty())
        || !spec.args.is_empty()
        || !spec.env.is_empty()
        || spec.cwd.as_ref().is_some_and(|c| !c.trim().is_empty())
}

fn http_fields_set(spec: &McpAddSpec) -> bool {
    spec.url.as_ref().is_some_and(|u| !u.trim().is_empty())
        || !spec.headers.is_empty()
        || spec
            .bearer_token_env_var
            .as_ref()
            .is_some_and(|v| !v.trim().is_empty())
        || spec
            .oauth_client_id
            .as_ref()
            .is_some_and(|v| !v.trim().is_empty())
        || spec
            .oauth_client_secret
            .as_ref()
            .is_some_and(|v| !v.trim().is_empty())
        || spec.oauth_callback_port.is_some()
        || spec
            .oauth_client_name
            .as_ref()
            .is_some_and(|v| !v.trim().is_empty())
}

fn push_stdio(args: &mut Vec<String>, spec: &McpAddSpec) -> Result<(), String> {
    if http_fields_set(spec) {
        return Err("HTTP fields are not allowed on a command server".into());
    }
    let command = spec
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "a command server needs a command".to_string())?;
    for (key, value) in &spec.env {
        if !env_key_ok(key) {
            return Err(format!("invalid environment variable name \"{key}\""));
        }
        args.push("--env".to_string());
        args.push(format!("{key}={value}"));
    }
    push_opt(args, "--cwd", &spec.cwd);
    args.push("--".to_string());
    args.push(command.to_string());
    args.extend(spec.args.iter().cloned());
    Ok(())
}

fn push_http(args: &mut Vec<String>, spec: &McpAddSpec) -> Result<(), String> {
    if stdio_fields_set(spec) {
        return Err("command fields are not allowed on a URL server".into());
    }
    let url = spec
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "a URL server needs a url".to_string())?;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("url must start with http:// or https://".into());
    }
    args.push("--url".to_string());
    args.push(url.to_string());
    for (key, value) in &spec.headers {
        if key.is_empty() || key.contains('=') || key.chars().any(char::is_whitespace) {
            return Err(format!("invalid header name \"{key}\""));
        }
        args.push("--header".to_string());
        args.push(format!("{key}={value}"));
    }
    if let Some(name) = spec
        .bearer_token_env_var
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !env_key_ok(name))
    {
        return Err(format!("invalid environment variable name \"{name}\""));
    }
    push_opt(args, "--bearer-token-env-var", &spec.bearer_token_env_var);
    push_opt(args, "--oauth-client-id", &spec.oauth_client_id);
    push_opt(args, "--oauth-client-secret", &spec.oauth_client_secret);
    if let Some(port) = spec.oauth_callback_port {
        args.push("--oauth-callback-port".to_string());
        args.push(port.to_string());
    }
    push_opt(args, "--oauth-client-name", &spec.oauth_client_name);
    Ok(())
}

pub fn remove_args(name: &str, scope: McpScope) -> Result<Vec<String>, String> {
    validate_server_name(name)?;
    let mut args = vec!["mcp".to_string(), "remove".to_string(), name.to_string()];
    args.extend(scope_args(scope));
    Ok(args)
}

pub fn list_args() -> Vec<String> {
    vec!["mcp".to_string(), "list".to_string(), "--json".to_string()]
}

/// The JSON document from `pi mcp list --json`. A line of noise before the
/// object is ignored. `servers` and `errors` must both be arrays.
pub fn parse_list(stdout: &str) -> Result<Value, String> {
    let start = stdout
        .find('{')
        .ok_or_else(|| "pi mcp list printed no JSON".to_string())?;
    let end = stdout
        .rfind('}')
        .ok_or_else(|| "pi mcp list printed no JSON".to_string())?;
    if end < start {
        return Err("pi mcp list printed no JSON".into());
    }
    let value: Value = serde_json::from_str(&stdout[start..=end])
        .map_err(|error| format!("pi mcp list JSON: {error}"))?;
    if !value.get("servers").is_some_and(Value::is_array)
        || !value.get("errors").is_some_and(Value::is_array)
    {
        return Err("pi mcp list JSON needs servers and errors arrays".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stdio(name: &str) -> McpAddSpec {
        McpAddSpec {
            name: name.into(),
            scope: "global".into(),
            kind: "stdio".into(),
            exposure: None,
            description: None,
            command: Some("npx".into()),
            args: vec!["-y".into(), "server".into()],
            env: vec![],
            cwd: None,
            url: None,
            headers: vec![],
            bearer_token_env_var: None,
            oauth_client_id: None,
            oauth_client_secret: None,
            oauth_callback_port: None,
            oauth_client_name: None,
        }
    }

    #[test]
    fn names_are_letters_digits_and_dashes_up_to_64() {
        assert!(validate_server_name("echo").is_ok());
        assert!(validate_server_name("a-b_c").is_ok());
        assert!(validate_server_name("").is_err());
        assert!(validate_server_name("bad name").is_err());
        assert!(validate_server_name(&"a".repeat(65)).is_err());
    }

    #[test]
    fn stdio_argv_puts_a_dash_dash_before_the_command() {
        let mut spec = stdio("echo");
        spec.args = vec!["a file".into(), "--flag".into()];
        spec.env = vec![("TOKEN".into(), "${TOKEN}".into())];
        spec.cwd = Some("D:/work".into());
        spec.exposure = Some("direct".into());
        let args = add_args(&spec).unwrap();
        let dash = args.iter().position(|part| part == "--").unwrap();
        assert_eq!(
            &args[..=dash],
            [
                "mcp",
                "add",
                "echo",
                "--exposure",
                "direct",
                "--env",
                "TOKEN=${TOKEN}",
                "--cwd",
                "D:/work",
                "--"
            ]
            .as_slice()
        );
        assert_eq!(&args[dash + 1..], ["npx", "a file", "--flag"]);
    }

    #[test]
    fn project_scope_adds_local() {
        let mut spec = stdio("echo");
        spec.scope = "project".into();
        let args = add_args(&spec).unwrap();
        assert!(args.iter().any(|part| part == "--local"));
        assert_eq!(
            remove_args("echo", McpScope::Project).unwrap()[3],
            "--local"
        );
    }

    #[test]
    fn http_argv_carries_headers_bearer_and_oauth() {
        let spec = McpAddSpec {
            name: "remote".into(),
            scope: "global".into(),
            kind: "http".into(),
            exposure: Some("hidden".into()),
            description: Some("Sentry".into()),
            command: None,
            args: vec![],
            env: vec![],
            cwd: None,
            url: Some("https://mcp.sentry.dev/mcp".into()),
            headers: vec![("X-Test".into(), "1".into())],
            bearer_token_env_var: Some("SENTRY_TOKEN".into()),
            oauth_client_id: Some("id".into()),
            oauth_client_secret: Some("${SECRET}".into()),
            oauth_callback_port: Some(1455),
            oauth_client_name: Some("SPOPI".into()),
        };
        let args = add_args(&spec).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["--header", "X-Test=1"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--bearer-token-env-var", "SENTRY_TOKEN"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--oauth-client-secret", "${SECRET}"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--oauth-callback-port", "1455"]));
        let mut spec = spec;
        spec.bearer_token_env_var = Some("--help".into());
        assert!(add_args(&spec)
            .unwrap_err()
            .contains("environment variable"));
    }

    #[test]
    fn mixed_stdio_and_http_fields_are_rejected() {
        let mut spec = stdio("echo");
        spec.url = Some("https://example.com".into());
        assert!(add_args(&spec).unwrap_err().contains("HTTP"));
        spec.url = None;
        spec.kind = "http".into();
        spec.command = Some("npx".into());
        assert!(add_args(&spec).unwrap_err().contains("command"));
        spec.command = None;
        spec.args.clear();
        spec.exposure = Some("nope".into());
        spec.url = Some("https://example.com".into());
        assert!(add_args(&spec).unwrap_err().contains("exposure"));
    }

    #[test]
    fn parse_list_reads_the_captured_fixtures() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/pi-cli");
        let empty =
            parse_list(&std::fs::read_to_string(dir.join("mcp-list-empty.json")).unwrap()).unwrap();
        assert_eq!(empty["servers"].as_array().unwrap().len(), 0);
        let mixed =
            parse_list(&std::fs::read_to_string(dir.join("mcp-list-mixed.json")).unwrap()).unwrap();
        let servers = mixed["servers"].as_array().unwrap();
        assert_eq!(servers.len(), 4);
        assert_eq!(servers[0]["state"], "connected");
        assert_eq!(servers[0]["tools"].as_array().unwrap().len(), 3);
        assert_eq!(servers[0]["override"], r"C:\Users\me\code\app\.pi\mcp.json");
        assert_eq!(servers[2]["state"], "needs-auth");
        assert_eq!(servers[2]["transport"], "https://mcp.sentry.dev/mcp");
        assert_eq!(servers[3]["state"], "disabled");
        assert_eq!(mixed["errors"].as_array().unwrap().len(), 1);
        let junked = format!(
            "pi: noise\n{}",
            std::fs::read_to_string(dir.join("mcp-list-empty.json")).unwrap()
        );
        assert!(parse_list(&junked).unwrap()["servers"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn list_args_are_mcp_list_json() {
        assert_eq!(list_args(), ["mcp", "list", "--json"]);
    }
}
