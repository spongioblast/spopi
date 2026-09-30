// ABOUTME: Declares the host-operation dispatcher.
// ABOUTME: Operation names are the match arms in dispatch.rs.
//! Host-request operations. `dispatch` owns the match.

pub(crate) mod dependencies;
pub(crate) mod dispatch;
pub(crate) mod os;
pub(crate) mod packages;
pub(crate) mod projects;
pub(crate) mod sessions;
pub(crate) mod skills;
