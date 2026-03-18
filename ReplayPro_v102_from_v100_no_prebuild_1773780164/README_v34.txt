ReplayPro v34

HDMI-only rewrite based on the stable v32.1 build.

What changed:
- ProgramOutputWindow now uses WriteableBitmap for HDMI/program output
- HDMI output no longer depends only on BitmapImage frames
- Added PrepareHdmiFrame(...) for a conservative 1080i50 -> 720p progressive path
- GUI preview remains separate and uses 960x540
- live GUI timer improved from 80 ms to 40 ms

Intent:
- smoother HDMI output
- less soft/kornete picture
- no changes to the replay workflow or GUI logic
