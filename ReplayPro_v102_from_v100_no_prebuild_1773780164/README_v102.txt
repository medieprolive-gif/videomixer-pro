ReplayPro v102 from v100

Built directly from v100 as a rollback-safe base.
Changes:
- no prebuilt replay frames from v101
- selected native clip playback uses the same smooth replay helper path as instant replay
- minor status cleanup only
- goal: keep the faster v100 behavior while avoiding the v101 slowdown/freezeframe regression
