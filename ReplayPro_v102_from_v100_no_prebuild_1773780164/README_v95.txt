ReplayPro v95 fast replay buffer

Built from v94.
Changes:
- fast replay selection path that avoids clip registration during replay startup
- clip list registration moved until after playback finishes
- auto replay uses same fast selection path
- playback queue still enforces one replay job at a time
- slightly lighter replay pacing for better responsiveness
