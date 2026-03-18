ReplayPro v62 stable broadcast frame pipeline

Focus:
- fix the OpenCvSharp Mat access violation seen in v61
- keep the delegated GPU render path
- make frame ownership safer before texture upload

Changed:
- GpuProgramOutputWindow.SetFrameMat now clones the incoming frame before rendering
- GpuShaderRenderer.TryRender also clones and owns the source frame internally
- added basic locking around GPU render/clear operations
- fallback clear/present path remains in place if shader render fails

Goal:
- stop crashes caused by invalid or reused Mat memory
- preserve the working GPU texture upload path
- create a more stable base for later image-quality work
