ReplayPro v83.5

Fixed the input-mode selector changes coherently:
- CreateCameraWorkers now takes camera index + mode for both cameras
- CameraCaptureWorker constructor call now passes requested width/height/fps
- constructor/apply paths now call the 4-argument CreateCameraWorkers overload
