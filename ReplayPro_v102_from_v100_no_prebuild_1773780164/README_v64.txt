ReplayPro v64

HDMI cleanup pass based on the working v63 branch.

Changed:
- slightly softer field-reduction cleanup before 720p scale
- keeps Lanczos4 scaling
- very mild denoise + balance pass before BGRA conversion
- no changes to replay workflow or project structure

Goal:
- reduce the upscaled / crispy look a little more
- preserve the stable v62/v63 project path
