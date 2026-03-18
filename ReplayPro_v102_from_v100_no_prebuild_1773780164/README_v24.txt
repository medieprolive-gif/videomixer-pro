ReplayPro v24 Performance Build

Fixed:
- added missing UpdateRecordingIndicatorUi
- removed duplicate UpdateReplayTimelineUi issue

Performance changes:
- slower UI live refresh timer (80 ms)
- preview frames resized to 640x360 before bitmap conversion
- replay timeline now skips redraw when playhead/livestate did not change
- removed duplicate timeline update in live tick

Goal:
- lower CPU usage on Lenovo ThinkCentre M910q
- keep 720p workflow while making previews cheaper to render
