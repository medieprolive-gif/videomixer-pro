ReplayPro v99 smooth pacing + background clip save

Built from v98.
Changes:
- replay playback now uses stopwatch-based frame pacing instead of a fixed rough delay
- UI presentation is awaited on Dispatcher with Render priority for more even replay timing
- replay clips are saved to the library in the background after playback finishes
- this should reduce clip-list delay and reduce some mid-playback disposed-Mat risk
