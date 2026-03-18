ReplayPro v70 broadcast engine

Built from the stable v66 line and fully rewrites the GPU HDMI files to keep the code coherent and compile-safe.

What changed:
- rewrote GpuProgramOutputWindow.cs cleanly
- rewrote GpuShaderRenderer.cs cleanly
- keeps the working delegated GPU upload/present path
- stores the latest frame safely
- adds a low-frequency watchdog re-present path to reduce HDMI freeze without the motion jerk from a constant render loop

Goal:
- keep the smoother motion from the v66 line
- reduce HDMI freeze in live and clip playback
- continue the gradual HDMI quality improvements
