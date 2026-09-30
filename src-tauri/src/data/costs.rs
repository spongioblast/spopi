// ABOUTME: Builds the usage dashboard from session JSONL metrics.
// ABOUTME: A cache keeps an unchanged session file from being parsed again.
// ABOUTME: Cost dashboard scan/cache for the data plane.
use super::*;

impl HostDataPlane {
    pub fn cost_dashboard(&self, workspace_id: &str) -> Result<CostDashboard, HostDataError> {
        // Validate the workspace id (keeps the RPC contract), but the dashboard
        // aggregates usage across ALL projects under the session root — the UI
        // is designed to rank projects globally, not scope to one workspace.
        let _ = self.workspace_root(workspace_id)?;
        let metrics = self.scan_cost_metrics()?;
        Ok(build_cost_dashboard(metrics))
    }

    /// Scan the shared session tree once to warm the parsed-metrics cache.
    /// Best-effort: used at startup so the first Usage open answers from cache
    /// instead of parsing hundreds of MB of session jsonl on the request path.
    pub fn prewarm_cost_metrics(&self) {
        let _ = self.scan_cost_metrics();
    }

    // Reads Pi's session JSONL directly: no runtime is alive for closed sessions and no RPC lists them.
    fn scan_cost_metrics(&self) -> Result<Vec<SessionMetrics>, HostDataError> {
        // Phase 1 — candidates with (path, mtime, len): metadata only, so a
        // scan of hundreds of MB of history stays cheap at the directory walk.
        let mut candidates = Vec::new();
        for path in self.session_files() {
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            candidates.push((path, modified, meta.len()));
        }
        // Phase 2 — cache hits resolve without touching the file; only misses
        // reach the parallel parse below. The lock is held just for this split
        // and the insert afterwards — never across worker threads.
        let mut metrics_all = Vec::new();
        let mut misses = Vec::new();
        {
            let cache = self
                .cost_metrics_cache
                .lock()
                .map_err(|_| HostDataError::Io("cost metrics cache poisoned".into()))?;
            for (path, modified, len) in &candidates {
                match cache.get(path) {
                    Some(cached) if cached.modified == *modified && cached.len == *len => {
                        metrics_all.push(cached.metrics.clone());
                    }
                    _ => misses.push((path.clone(), *modified, *len)),
                }
            }
        }
        if let Some(store) = &self.meta_cache {
            if let Ok(guard) = store.lock() {
                let mut still_missing = Vec::new();
                for (path, modified, len) in misses {
                    let millis = modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|elapsed| elapsed.as_millis() as i64)
                        .unwrap_or(0);
                    let hit = guard
                        .read_cache("cost_metrics_cache", &path.to_string_lossy())
                        .ok()
                        .flatten()
                        .filter(|(mtime, cached_len, _)| {
                            *mtime == millis && *cached_len == len as i64
                        })
                        .and_then(|(_, _, json)| {
                            serde_json::from_str::<SessionMetrics>(&json).ok()
                        });
                    if let Some(metrics) = hit {
                        metrics_all.push(metrics);
                    } else {
                        still_missing.push((path, modified, len));
                    }
                }
                misses = still_missing;
            }
        }
        // Phase 3 — parse misses in parallel on plain std threads (no async
        // runtime here, no new deps): JSON line parsing is CPU-bound and
        // dominates the cold scan. Biggest file first keeps the fixed-count
        // chunks byte-balanced. build_cost_dashboard sorts every aggregate
        // deterministically, so thread merge order cannot change the payload.
        misses.sort_by_key(|&(_, _, len)| std::cmp::Reverse(len));
        let workers = std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1)
            .clamp(1, 8);
        let chunk_size = misses.len().div_ceil(workers).max(1);
        let mut parsed: Vec<(PathBuf, SystemTime, u64, SessionMetrics)> = Vec::new();
        std::thread::scope(|scope| -> Result<(), HostDataError> {
            let handles: Vec<_> = misses
                .chunks(chunk_size)
                .map(|chunk| {
                    scope.spawn(move || {
                        let mut chunk_metrics = Vec::with_capacity(chunk.len());
                        for (path, modified, len) in chunk {
                            if let Some(metrics) = parse_session_metrics(path, None)? {
                                chunk_metrics.push((path.clone(), *modified, *len, metrics));
                            }
                        }
                        Ok(chunk_metrics)
                    })
                })
                .collect();
            for handle in handles {
                let chunk_metrics = handle
                    .join()
                    .map_err(|_| HostDataError::Io("cost scan worker panicked".into()))??;
                parsed.extend(chunk_metrics);
            }
            Ok(())
        })?;
        if !parsed.is_empty() {
            let mut cache = self
                .cost_metrics_cache
                .lock()
                .map_err(|_| HostDataError::Io("cost metrics cache poisoned".into()))?;
            for (path, modified, len, metrics) in &parsed {
                cache.insert(
                    path.clone(),
                    CachedMetrics {
                        modified: *modified,
                        len: *len,
                        metrics: metrics.clone(),
                    },
                );
            }
        }
        if let Some(store) = &self.meta_cache {
            if let Ok(guard) = store.lock() {
                for (path, modified, len, metrics) in &parsed {
                    let millis = modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|elapsed| elapsed.as_millis() as i64)
                        .unwrap_or(0);
                    if let Ok(json) = serde_json::to_string(metrics) {
                        let _ = guard.write_cache(
                            "cost_metrics_cache",
                            &path.to_string_lossy(),
                            millis,
                            *len as i64,
                            &json,
                        );
                    }
                }
            }
        }
        metrics_all.extend(parsed.into_iter().map(|(_, _, _, metrics)| metrics));
        Ok(metrics_all)
    }
}
