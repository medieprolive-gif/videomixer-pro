ReplayPro v90

Built from v88.

Changes:
- clean autoreplay rewrite based on the original AutoReplay_Click method
- adds autoreplay busy guard
- skips autoreplay while SSD recording is active
- uses BeginInvoke for UI updates inside autoreplay playback callback
- Take Live clears autoreplay busy state
