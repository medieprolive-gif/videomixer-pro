ReplayPro v82 input mode selector

Built from the stable v74 clean base.

Added:
- Camera 1 mode selector
- Camera 2 mode selector
- actual mode text readout for each camera

Modes included:
- 1920x1080@50
- 1920x1080@30
- 1280x720@50
- 1280x720@30

Technical:
- CameraCaptureWorker now requests width/height/fps at capture open
- MainWindow shows requested and actual input mode behavior
