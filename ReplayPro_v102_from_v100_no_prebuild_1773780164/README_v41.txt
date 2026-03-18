ReplayPro v41

Changes:
- pgmWindow now uses IProgramOutputSink
- output interface now supports both SetFrame(ImageSource) and SetFrameMat(Mat)
- OpenProgramOutputOnSecondScreen now tries GpuProgramOutputWindow first
- falls back to ProgramOutputWindow if GPU output fails to initialize

Purpose:
- create a clean GPU-wired branch without changing replay workflow
- keep compile-safety while preparing the next true GPU texture upload step
