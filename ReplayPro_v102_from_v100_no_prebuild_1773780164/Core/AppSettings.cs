namespace ReplayPro.Core
{
    public class AppSettings
    {
        public int FPS = 30;
        public int ReplaySeconds = 20;
        public int AutoReplaySeconds = 5;
        public int Camera1Index = 0;
        public int Camera2Index = 1;
        public string Camera1Mode = "1920x1080@50";
        public string Camera2Mode = "1920x1080@50";

        public string ExportFolder =
            System.IO.Path.Combine(
                System.Environment.GetFolderPath(System.Environment.SpecialFolder.Desktop),
                "ReplayExports");

        public string ClipStorageFolder =
            System.IO.Path.Combine(
                System.Environment.GetFolderPath(System.Environment.SpecialFolder.Desktop),
                "ReplayClips");

        public string ReplayBufferFolder =
            System.IO.Path.Combine(
                System.Environment.GetFolderPath(System.Environment.SpecialFolder.Desktop),
                "ReplayBuffer");

        public int ReplayBufferMinutes = 5;
        public int SegmentSeconds = 3;
    }
}
