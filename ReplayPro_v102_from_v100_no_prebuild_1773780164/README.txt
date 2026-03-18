ReplayPro v22.5b HID Fallback

This build removes the experimental SDK path probing and goes back to the stable HID-based shuttle path.

Included:
- stable replay/jog/shuttle GUI
- larger camera timecode and IN/OUT overlays
- clip storage selection
- automatic clip save to selected disk
- Shuttle status in HID mode only

This build is intended to avoid the SDK path compile errors.

Build:
1. Open ReplayPro.csproj
2. Let NuGet restore finish
3. Build in x64
4. Run
