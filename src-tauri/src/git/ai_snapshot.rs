// ABOUTME: Captures a stable staged diff for the AI commit-message request.
// ABOUTME: The dispatcher sends that snapshot; this module only reads git.

use super::*;

impl GitService {
    pub fn prepare_ai_snapshot(
        &self,
        owner: &str,
        root: &Path,
        generation: u64,
    ) -> Result<GitAiSnapshot, String> {
        // Read-consistency protocol: capture the index tree before and after
        // reading porcelain + staged diff. If the tree changed between the two
        // reads (because an external process mutated the index), retry up to
        // 3 times; if it never stabilizes, refuse to create a snapshot whose
        // staged diff does not match its bound index tree.
        const MAX_RETRIES: usize = 3;
        for _attempt in 0..MAX_RETRIES {
            let tree_before = git(root, &["write-tree"])
                .ok()
                .map(|v| display_path(&v).trim().to_owned());
            let status = self.status(owner, root, generation)?;
            if status.counts.staged == 0 {
                return Err("no staged changes".into());
            }
            if status.counts.conflicted > 0 {
                return Err("conflicted changes".into());
            }
            let diff = git(
                root,
                &[
                    "--literal-pathspecs",
                    "diff",
                    "--cached",
                    "--binary",
                    "--no-color",
                    "--",
                ],
            )?;
            let tree_after = git(root, &["write-tree"])
                .ok()
                .map(|v| display_path(&v).trim().to_owned());
            // Three-way consistency: the index tree captured before reading
            // status, the tree status() bound to the snapshot, and the tree
            // captured after reading the staged diff must all be equal. If any
            // differ, an external process mutated the index between reads and
            // the staged diff may not correspond to the bound tree — retry.
            if tree_before != tree_after || status.index_tree_oid != tree_before {
                continue;
            }
            let (staged_diff, staged_diff_truncated) = bounded_ai_diff(&diff);
            return Ok(GitAiSnapshot {
                snapshot_id: status.snapshot_id,
                head_state: status.head_state,
                head_oid: status.head_oid,
                index_tree_oid: status.index_tree_oid,
                staged_diff,
                staged_diff_truncated,
            });
        }
        Err("staged diff did not stabilize".into())
    }
}
