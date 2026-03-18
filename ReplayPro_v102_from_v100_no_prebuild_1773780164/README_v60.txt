ReplayPro v60 shader renderer base

What this is:
- a compile-safe base branch for a future shader-based HDMI renderer

What changed:
- added GpuShaderRenderer.cs
- GpuProgramOutputWindow now creates a shaderRenderer scaffold
- SetFrameMat() tries the future shader path first, then falls back to the existing working GPU texture path

Important:
- this is a base/scaffold, not a full OBS-equivalent renderer yet
- current visual output should remain close to the working v42.1 GPU branch
- this branch is intended to prepare the next true shader/quad rendering step without breaking build stability
