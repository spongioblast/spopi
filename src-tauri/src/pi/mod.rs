// ABOUTME: Declares the Pi runtime, RPC bridge, launch, and child supervision.
// ABOUTME: This folder does not implement the agent loop.
//! The embedded Pi runtime: process supervision, RPC, and launch.
//!
//! One `PiRuntime` owns the `pi --mode rpc` child for a workspace.

pub(crate) mod binary;
pub(crate) mod child_supervision;
pub(crate) mod cli;
pub(crate) mod cli_parse;
pub(crate) mod coordinator;
pub(crate) mod launch;
pub(crate) mod rpc;
pub(crate) mod runtime;
pub(crate) mod session_bind;
