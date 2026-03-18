ReplayPro v88

Built from v86.

Changes:
- DiskRecordController now uses async queues and dedicated writer tasks per camera
- frames are cloned before entering disk queues
- CameraCaptureWorker now provides TryGetLatestFrameClone() with locking
- live preview / disk recording / HDMI in MainWindow now use safe cloned frames from the workers

Goal:
- avoid AccessViolationException in OpenCvSharp.Mat during SSD recording
- reduce lockups and stutter when recording and replay are active together
