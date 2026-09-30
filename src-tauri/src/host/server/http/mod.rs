// ABOUTME: Loopback HTTP handlers grouped by files, git, search, and phone.
// ABOUTME: The server router table is the only caller of these handlers.

pub(super) mod engine;
pub(super) mod files;
pub(super) mod git;
pub(crate) mod phone;
pub(super) mod routes;
pub(super) mod screenshot;
pub(super) mod search;
pub(crate) mod ui;
