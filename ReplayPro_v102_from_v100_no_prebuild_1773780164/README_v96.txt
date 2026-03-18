ReplayPro v96 direct buffer replay

Built from v95.
Changes:
- FrameRingBuffer now has thread-safe locking
- new GetLatestRangeReferences(count) avoids full Snapshot() clone path
- Last5s/AutoReplay selection now pulls latest frame references directly from buffer
- replay still clones one frame at a time during playback only
- no broad MainWindow rewrites; targeted replay extraction change only
