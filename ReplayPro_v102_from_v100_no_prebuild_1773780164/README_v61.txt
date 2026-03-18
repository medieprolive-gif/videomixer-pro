ReplayPro v61

This build takes the next real HDMI-render step after v60.

Changed:
- GpuShaderRenderer now performs an actual delegated GPU render path
- prepares a 1280x720 BGRA frame
- uploads the frame to a D3D11 texture
- copies that texture to the swapchain backbuffer
- GpuProgramOutputWindow now tries shaderRenderer first and falls back only if it fails

Important:
- this is still not a full OBS-like textured quad + shader pipeline
- but it is the first version where the delegated renderer actually performs the frame upload/present work
- replay workflow remains untouched
