ReplayPro v98 safe saved clip path

Built from v97.
Changes:
- instant replay still uses direct buffer references for fast start
- clips added to the library are now deep-cloned into a safe owned frame list
- selected clip playback should no longer hit disposed OpenCvSharp.Mat objects
- replay clip registration happens after playback and uses a background clone pass
