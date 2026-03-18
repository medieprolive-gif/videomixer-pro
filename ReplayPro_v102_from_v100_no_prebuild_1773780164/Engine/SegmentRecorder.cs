
using System;
using System.IO;
using OpenCvSharp;

namespace ReplayPro.Engine
{
    public class SegmentRecorder : IDisposable
    {
        private readonly string rootFolder;
        private readonly string cameraName;
        private readonly int fps;
        private readonly int segmentSeconds;

        private VideoWriter? writer;
        private DateTime segmentStartUtc;
        private bool disposed;

        public SegmentRecorder(string rootFolder, string cameraName, int fps, int segmentSeconds)
        {
            this.rootFolder = rootFolder;
            this.cameraName = cameraName;
            this.fps = fps;
            this.segmentSeconds = segmentSeconds;
            Directory.CreateDirectory(GetCameraFolder());
        }

        public string GetCameraFolder() => Path.Combine(rootFolder, cameraName);

        public void AppendFrame(Mat frame)
        {
            if (disposed || frame == null || frame.Empty())
                return;

            if (writer == null)
                StartNewSegment(frame);

            if ((DateTime.UtcNow - segmentStartUtc).TotalSeconds >= segmentSeconds)
            {
                CloseSegment();
                StartNewSegment(frame);
            }

            writer?.Write(frame);
        }

        private void StartNewSegment(Mat frame)
        {
            segmentStartUtc = DateTime.UtcNow;
            string fileName = $"{cameraName}_{segmentStartUtc:yyyyMMdd_HHmmss}.avi";
            string path = Path.Combine(GetCameraFolder(), fileName);

            writer = new VideoWriter(
                path,
                FourCC.MJPG,
                fps,
                new OpenCvSharp.Size(frame.Width, frame.Height));
        }

        private void CloseSegment()
        {
            try
            {
                writer?.Release();
                writer?.Dispose();
            }
            catch
            {
            }
            writer = null;
        }

        public void Dispose()
        {
            if (disposed)
                return;
            disposed = true;
            CloseSegment();
        }
    }
}
