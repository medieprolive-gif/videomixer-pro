ReplayPro v97 selected clip playback fix

Built from v96.
Changes:
- ReplaySelected_Click now uses the replay queue and the same smoother playback path as Last5s
- selected native clips no longer use the older per-frame Dispatcher.Invoke loop
- one replay job at a time is enforced for selected clip playback too
- clip playback focus only; no broad pipeline changes
