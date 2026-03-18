using System;
using System.Linq;
using HidLibrary;

namespace ReplayPro.Engine
{
    public class ShuttleInputService
    {
        private HidDevice device;
        private byte lastButtons = 0;
        private byte lastJog = 0;

        public bool IsConnected { get; private set; }
        public byte LastButtonBits { get; private set; }
        public byte LastJogRaw { get; private set; }

        public string DetectedDeviceName { get; private set; } = "None";
        public string DebugDeviceList { get; private set; } = "";
        public string LastRawReport { get; private set; } = "";

        // Contour Design vendor id
        private const int ContourVendorId = 0x0B33;

        public event Action ReplayPressed;
        public event Action MarkInPressed;
        public event Action MarkOutPressed;
        public event Action SaveClipPressed;
        public event Action TakeLivePressed;
        public event Action JogLeft;
        public event Action JogRight;

        private static string SafeDescription(HidDevice d)
        {
            try
            {
                return string.IsNullOrWhiteSpace(d.Description) ? "(no name)" : d.Description;
            }
            catch
            {
                return "(hid device)";
            }
        }

        public void Start()
        {
            var devices = HidDevices.Enumerate().ToList();

            DebugDeviceList = string.Join(" | ",
                devices.Select(d => $"VID:{d.Attributes.VendorId:X4} PID:{d.Attributes.ProductId:X4} {SafeDescription(d)}"));

            device = devices.FirstOrDefault(d => d.Attributes.VendorId == ContourVendorId);

            if (device == null)
            {
                device = devices.FirstOrDefault(d =>
                {
                    string desc = SafeDescription(d).ToLowerInvariant();
                    return desc.Contains("shuttle") || desc.Contains("contour");
                });
            }

            IsConnected = device != null;

            if (device != null)
            {
                DetectedDeviceName =
                    $"VID:{device.Attributes.VendorId:X4} PID:{device.Attributes.ProductId:X4} {SafeDescription(device)}";

                try
                {
                    device.OpenDevice();
                    ReadLoop();
                }
                catch
                {
                    // keep detected info visible even if open fails
                }
            }
            else
            {
                DetectedDeviceName = "None";
                LastButtonBits = 0;
                LastJogRaw = 0;
            }
        }

        private void ReadLoop()
        {
            if (device == null)
                return;

            try
            {
                device.ReadReport(OnReport);
            }
            catch
            {
                // ignore read failures, keep app alive
            }
        }

        private void OnReport(HidReport report)
        {
            if (report.Exists && report.Data != null && report.Data.Length > 0)
            {
                LastRawReport = string.Join("-", report.Data.Select(b => b.ToString("X2")));

                byte buttons = report.Data.Length > 3 ? report.Data[3] : (byte)0;
                LastButtonBits = buttons;

                byte newlyPressed = (byte)(buttons & ~lastButtons);

                if ((newlyPressed & 1) == 1)
                    ReplayPressed?.Invoke();
                if ((newlyPressed & 2) == 2)
                    MarkInPressed?.Invoke();
                if ((newlyPressed & 4) == 4)
                    MarkOutPressed?.Invoke();
                if ((newlyPressed & 8) == 8)
                    SaveClipPressed?.Invoke();
                if ((newlyPressed & 16) == 16)
                    TakeLivePressed?.Invoke();

                byte[] candidates = new byte[]
                {
                    report.Data.Length > 0 ? report.Data[0] : (byte)0,
                    report.Data.Length > 1 ? report.Data[1] : (byte)0,
                    report.Data.Length > 2 ? report.Data[2] : (byte)0
                };

                byte jog = candidates[1];
                int bestDelta = 0;

                foreach (var candidate in candidates)
                {
                    int delta = candidate - lastJog;
                    if (delta > 127)
                        delta -= 256;
                    if (delta < -127)
                        delta += 256;

                    if (System.Math.Abs(delta) > System.Math.Abs(bestDelta))
                    {
                        bestDelta = delta;
                        jog = candidate;
                    }
                }

                LastJogRaw = jog;

                if (bestDelta != 0)
                {
                    int steps = System.Math.Abs(bestDelta);
                    if (steps > 8)
                        steps = 8;

                    if (bestDelta > 0)
                    {
                        for (int i = 0; i < steps; i++)
                            JogRight?.Invoke();
                    }
                    else
                    {
                        for (int i = 0; i < steps; i++)
                            JogLeft?.Invoke();
                    }

                    lastJog = jog;
                }

                lastButtons = buttons;
            }

            ReadLoop();
        }
    }
}
