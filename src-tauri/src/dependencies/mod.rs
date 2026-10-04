// ABOUTME: Checks and installs the tools SPOPI and Pi need on this computer.
// ABOUTME: Built-in binaries are only detected; on-demand installs run as jobs.

pub(crate) mod agent_browser;
pub(crate) mod browsers;
pub(crate) mod check;
pub(crate) mod exec;
pub(crate) mod jobs;
#[cfg_attr(windows, allow(dead_code))]
pub(crate) mod node_download;
pub(crate) mod npm;
pub(crate) mod surf;
