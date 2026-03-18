ReplayPro v86 stable capture engine

Built from v83.5, keeping the working input mode selector and actual mode readout.

Added:
- safer CameraCaptureWorker capture loop
- empty/invalid frame protection
- auto reopen of capture after repeated empty frames
- frame safety in SnapshotPreviewImage, PushFrameToPgm, PrepareHdmiFrame, ConvertMat

Intent:
- avoid OpenCvSharp Mat crashes
- keep mode selector and mismatch info
- provide a stable base before more replay work
