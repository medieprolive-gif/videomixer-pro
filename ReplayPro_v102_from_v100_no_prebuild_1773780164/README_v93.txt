ReplayPro v93 non-blocking replay extraction

Built from v92.
Changes:
- Last5/8/10 and AutoReplay now build replay selections on a background worker
- replay extraction clones frames off the UI thread before playback starts
- live HDMI path is lightweight again and avoids CPU-heavy PrepareHdmiFrame in live mode
- replay output keeps higher quality scaling with Lanczos4
- no autosave during replay playback
