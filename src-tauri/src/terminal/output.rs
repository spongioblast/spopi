// ABOUTME: Per-terminal opaque output journal with monotonic sequence numbers,
// ABOUTME: checkpoint watermarking, bounded retention, and history-gap detection.
// ABOUTME: Stores opaque bytes only; never parses ANSI or runs an emulator.

use std::collections::VecDeque;

/// Default bounded sizes per terminal. A checkpoint caps retained screen state;
/// the journal caps post-checkpoint output retained for reattachment replay.
pub const DEFAULT_CHECKPOINT_BYTES: usize = 2 * 1024 * 1024;
pub const DEFAULT_JOURNAL_BYTES: usize = 4 * 1024 * 1024;

/// Per-terminal retention limits. Exact aggregate limits across all terminals
/// are enforced by `TerminalManager`, not by this store.
#[derive(Clone, Copy, Debug)]
pub struct TerminalLimits {
    pub checkpoint_bytes: usize,
    pub journal_bytes: usize,
}

impl Default for TerminalLimits {
    fn default() -> Self {
        Self {
            checkpoint_bytes: DEFAULT_CHECKPOINT_BYTES,
            journal_bytes: DEFAULT_JOURNAL_BYTES,
        }
    }
}

/// A merged run of retained journal output. `first_sequence` and
/// `last_sequence` are inclusive and refer to the underlying sequence space.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JournalBatch {
    pub first_sequence: u64,
    pub last_sequence: u64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputError {
    /// A serialized checkpoint exceeded the per-terminal checkpoint limit.
    CheckpointTooLarge { size: usize, limit: usize },
    /// A checkpoint watermark was below the highest already-accepted watermark.
    WatermarkRegressed { watermark: u64, current: u64 },
    /// A checkpoint watermark was ahead of the highest produced sequence.
    WatermarkAhead { watermark: u64, produced_top: u64 },
}

#[derive(Debug)]
struct JournalEntry {
    sequence: u64,
    bytes: Vec<u8>,
}

/// Opaque per-terminal output store.
///
/// Sequence numbers are strictly increasing `u64` values assigned on append.
/// A checkpoint discards journal entries at or below its watermark. When the
/// journal overflows after checkpointing, the oldest post-checkpoint entry is
/// dropped and `history_gap` is set so callers can warn that some background
/// output can no longer be reconstructed. The shell itself keeps running.
#[derive(Debug)]
pub struct TerminalOutputStore {
    limits: TerminalLimits,
    next_sequence: u64,
    journal: VecDeque<JournalEntry>,
    journal_bytes: usize,
    checkpoint: Option<Vec<u8>>,
    checkpoint_watermark: u64,
    highest_ack: u64,
    history_gap: bool,
}

impl TerminalOutputStore {
    pub fn new(limits: TerminalLimits) -> Self {
        Self {
            limits,
            next_sequence: 1,
            journal: VecDeque::new(),
            journal_bytes: 0,
            checkpoint: None,
            checkpoint_watermark: 0,
            highest_ack: 0,
            history_gap: false,
        }
    }

    pub fn checkpoint_watermark(&self) -> u64 {
        self.checkpoint_watermark
    }

    /// The latest accepted serialized checkpoint, if any.
    pub fn checkpoint(&self) -> Option<&[u8]> {
        self.checkpoint.as_deref()
    }

    pub fn history_gap(&self) -> bool {
        self.history_gap
    }

    /// Append a batch of raw PTY bytes, assign the next sequence, and enforce
    /// the journal bound. Returns the assigned sequence.
    pub fn append(&mut self, bytes: &[u8]) -> u64 {
        // Empty batches must not consume a sequence number: doing so would create
        // a gap (the next real batch would jump a number the frontend expects).
        if bytes.is_empty() {
            return self.next_sequence;
        }
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        self.journal_bytes += bytes.len();
        self.journal.push_back(JournalEntry {
            sequence,
            bytes: bytes.to_vec(),
        });
        self.enforce_journal_bound();
        sequence
    }

    /// Accept a serialized checkpoint covering all output through `watermark`.
    /// Stores the snapshot, discards journal entries at or below the watermark,
    /// and rejects oversized checkpoints or regressing watermarks without
    /// mutating state. The snapshot bytes are opaque and never parsed.
    pub fn accept_checkpoint(
        &mut self,
        watermark: u64,
        snapshot: Vec<u8>,
    ) -> Result<(), OutputError> {
        if snapshot.len() > self.limits.checkpoint_bytes {
            return Err(OutputError::CheckpointTooLarge {
                size: snapshot.len(),
                limit: self.limits.checkpoint_bytes,
            });
        }
        if watermark < self.checkpoint_watermark {
            return Err(OutputError::WatermarkRegressed {
                watermark,
                current: self.checkpoint_watermark,
            });
        }
        // A watermark ahead of the highest produced sequence would let a caller
        // discard not-yet-generated output. Highest legal watermark is next_sequence - 1.
        if watermark >= self.next_sequence {
            return Err(OutputError::WatermarkAhead {
                watermark,
                produced_top: self.next_sequence.saturating_sub(1),
            });
        }
        self.checkpoint_watermark = watermark;
        self.checkpoint = Some(snapshot);
        while let Some(front) = self.journal.front() {
            if front.sequence <= watermark {
                let Some(entry) = self.journal.pop_front() else {
                    break;
                };
                self.journal_bytes -= entry.bytes.len();
            } else {
                break;
            }
        }
        Ok(())
    }

    /// Record the highest sequence the frontend has acknowledged applying.
    pub fn ack(&mut self, sequence: u64) {
        if sequence > self.highest_ack {
            self.highest_ack = sequence;
        }
    }

    /// Return a merged batch of every retained journal entry whose sequence is
    /// strictly greater than `after_sequence`. Returns `None` when the journal
    /// holds nothing past that point.
    pub fn journal_from(&self, after_sequence: u64) -> Option<JournalBatch> {
        let mut bytes = Vec::new();
        let mut first: Option<u64> = None;
        let mut last = 0;
        for entry in self.journal.iter() {
            if entry.sequence > after_sequence {
                first.get_or_insert(entry.sequence);
                last = entry.sequence;
                bytes.extend_from_slice(&entry.bytes);
            }
        }
        first.map(|f| JournalBatch {
            first_sequence: f,
            last_sequence: last,
            bytes,
        })
    }

    fn enforce_journal_bound(&mut self) {
        if self.journal_bytes <= self.limits.journal_bytes {
            return;
        }
        // First reclaim entries already covered by the checkpoint; those are
        // reconstructable from the snapshot and must not set a gap.
        while self.journal_bytes > self.limits.journal_bytes {
            let drop_below_watermark = self
                .journal
                .front()
                .map(|e| e.sequence <= self.checkpoint_watermark)
                .unwrap_or(false);
            if !drop_below_watermark {
                break;
            }
            let Some(entry) = self.journal.pop_front() else {
                break;
            };
            self.journal_bytes -= entry.bytes.len();
        }
        // Still over: drop the oldest post-checkpoint entry and signal that
        // continuity can no longer be guaranteed. The shell keeps running.
        while self.journal_bytes > self.limits.journal_bytes {
            let entry = match self.journal.pop_front() {
                Some(e) => e,
                None => break,
            };
            self.journal_bytes -= entry.bytes.len();
            self.history_gap = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits() -> TerminalLimits {
        TerminalLimits::default()
    }

    #[test]
    fn append_assigns_strictly_increasing_sequences() {
        let mut output = TerminalOutputStore::new(limits());
        assert_eq!(output.append(b"one"), 1);
        assert_eq!(output.append(b"two"), 2);
        assert_eq!(output.append(b"three"), 3);
    }

    #[test]
    fn checkpoint_discards_only_journal_through_its_watermark() {
        let mut output = TerminalOutputStore::new(limits());
        output.append(b"one"); // sequence 1
        output.append(b"two"); // sequence 2
        output.accept_checkpoint(2, vec![1]).unwrap();
        output.append(b"three"); // sequence 3
        let batch = output.journal_from(2).expect("journal past watermark");
        assert_eq!(batch.first_sequence, 3);
        assert_eq!(batch.last_sequence, 3);
        assert_eq!(batch.bytes, b"three");
    }

    #[test]
    fn journal_overflow_sets_gap_but_does_not_drop_running_status() {
        let mut output = TerminalOutputStore::new(TerminalLimits {
            journal_bytes: 3,
            ..limits()
        });
        output.append(b"1234");
        assert!(output.history_gap());
    }

    #[test]
    fn oversized_checkpoint_is_rejected_without_mutating_state() {
        let mut output = TerminalOutputStore::new(TerminalLimits {
            checkpoint_bytes: 4,
            ..limits()
        });
        output.append(b"data"); // sequence 1
        let err = output.accept_checkpoint(1, vec![0u8; 10]).unwrap_err();
        assert!(matches!(err, OutputError::CheckpointTooLarge { .. }));
        assert_eq!(output.checkpoint_watermark(), 0);
        assert!(output.checkpoint().is_none());
    }

    #[test]
    fn regressing_watermark_is_rejected() {
        let mut output = TerminalOutputStore::new(limits());
        for _ in 0..5 {
            output.append(b"x");
        }
        // watermark 5 is legal (== highest produced, next_sequence - 1).
        output.accept_checkpoint(5, vec![1]).unwrap();
        // watermark 3 regresses below the accepted 5.
        assert!(output.accept_checkpoint(3, vec![1]).is_err());
    }

    #[test]
    fn future_watermark_is_rejected() {
        let mut output = TerminalOutputStore::new(limits());
        output.append(b"a"); // sequence 1; next_sequence 2
                             // watermark 5 has not been produced yet; accepting it would let a caller
                             // discard not-yet-generated output.
        assert!(output.accept_checkpoint(5, vec![1]).is_err());
    }

    #[test]
    fn journal_from_returns_none_when_empty_past_watermark() {
        let output = TerminalOutputStore::new(limits());
        assert!(output.journal_from(0).is_none());
    }

    #[test]
    fn checkpoint_below_watermark_entries_reclaim_without_gap() {
        let mut output = TerminalOutputStore::new(TerminalLimits {
            journal_bytes: 10,
            ..limits()
        });
        output.append(b"aaaa"); // sequence 1
        output.append(b"bbbb"); // sequence 2
        output.accept_checkpoint(1, vec![1]).unwrap(); // reclaims sequence 1
        assert!(!output.history_gap());
        let batch = output.journal_from(1).expect("sequence 2 remains");
        assert_eq!(batch.bytes, b"bbbb");
    }

    #[test]
    fn empty_append_does_not_consume_a_sequence() {
        let mut output = TerminalOutputStore::new(limits());
        // An empty batch returns the next sequence but does not advance it, so
        // the following real batch is not forced to skip a number.
        assert_eq!(output.append(b""), 1);
        assert_eq!(output.append(b"a"), 1);
        assert_eq!(output.append(b"b"), 2);
    }
}
