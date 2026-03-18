ReplayPro v94

Built from v93.

Changes:
- replay request building no longer clones every frame up front
- replay playback clones one frame at a time instead of bulk cloning
- replay UI/HDMI presentation uses the prepared bitmap directly
- lightweight live HDMI path from v93 is kept

Intent:
- reduce the pause when pressing Last5s / Auto Replay
- reduce replay busy time
- avoid the previous disposed-Mat risk in replay presentation
