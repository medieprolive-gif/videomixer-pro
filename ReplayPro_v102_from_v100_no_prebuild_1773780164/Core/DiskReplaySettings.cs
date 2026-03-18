
namespace ReplayPro.Core
{
    public class DiskReplaySettings
    {
        public string ReplayBufferFolder { get; set; } =
            System.IO.Path.Combine(
                System.Environment.GetFolderPath(System.Environment.SpecialFolder.Desktop),
                "ReplayBuffer");

        public int BufferMinutes { get; set; } = 5;
        public int SegmentSeconds { get; set; } = 3;
        public int Fps { get; set; } = 30;
    }
}
