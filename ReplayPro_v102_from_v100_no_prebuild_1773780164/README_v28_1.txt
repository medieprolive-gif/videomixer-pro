ReplayPro v28.1 ClipItem Fix

Fixed:
- clip bank now uses ReplayPro.Core.ClipItem instead of ReplayPro.Engine.ClipModel
- resolves CS0029:
  Cannot implicitly convert type 'ReplayPro.Core.ClipItem' to 'ReplayPro.Engine.ClipModel'

This keeps the clip bank aligned with the existing clip library type.
