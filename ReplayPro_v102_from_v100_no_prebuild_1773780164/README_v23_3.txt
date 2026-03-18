ReplayPro v23.3 Record GUI Wired

Added:
- Replay buffer folder picker
- Saved clips folder picker
- Buffer length selector
- START RECORD / STOP RECORD buttons
- REC ON / OFF status
- DiskRecordController wired into live camera timer
- Rolling segment recording engine files included

Current behavior:
- choose replay disk
- choose buffer length
- press START RECORD
- live camera frames are written as rolling AVI segments to replay disk
- old segments are trimmed by buffer minutes
- saved clips still go to the selected clip disk

Next stage:
v23.4
- timeline / playhead over SSD segments
- jog/shuttle from SSD instead of RAM
