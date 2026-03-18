ReplayPro v91 clean replay engine

Built from v90.
Changes:
- fixes the broken BeginInvoke patch problem from the previous v91 attempt
- adds a clean shared replay path: PlayReplaySelectionSmoothAsync(...)
- Last5s/8s/10s now use the shared smooth replay path
- AutoReplay now uses the same smooth replay path while keeping the v90 busy guard
- no changes to live capture path
