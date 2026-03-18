ReplayPro v42 true gpu

Focus:
- true GPU-oriented HDMI branch

Changed:
- GpuProgramOutputWindow now prepares a 1280x720 BGRA frame
- uploads each frame to a D3D11 Texture2D
- copies that texture to the swapchain backbuffer
- presents through the swapchain on each frame

Notes:
- replay logic and GUI workflow are unchanged
- this is the first branch that attempts real texture upload instead of only clearing/presenting the GPU window
- still uses a conservative 1080i50 -> 720p progressive preparation step before texture upload
