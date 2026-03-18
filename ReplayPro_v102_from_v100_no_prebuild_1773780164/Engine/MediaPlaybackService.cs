using System;
using System.Diagnostics;
using System.Threading.Tasks;
using OpenCvSharp;

namespace ReplayPro.Engine
{
    public class MediaPlaybackService
    {
        public async Task PlayFromFile(string filePath, Action<Mat, int> render, Func<bool> shouldStop)
        {
            using (var capture = new VideoCapture(filePath))
            using (var frame = new Mat())
            {
                if (!capture.IsOpened())
                    return;

                double fps = capture.Fps;
                if (fps <= 1.0 || fps > 240.0)
                    fps = 25.0;

                double frameDurationMs = 1000.0 / fps;
                int frameIndex = 0;

                var stopwatch = Stopwatch.StartNew();
                double nextFrameTimeMs = 0;

                while (true)
                {
                    if (shouldStop != null && shouldStop())
                        break;

                    capture.Read(frame);
                    if (frame.Empty())
                        break;

                    render(frame, frameIndex);
                    frameIndex++;

                    nextFrameTimeMs += frameDurationMs;

                    while (stopwatch.Elapsed.TotalMilliseconds < nextFrameTimeMs)
                    {
                        if (shouldStop != null && shouldStop())
                            break;

                        await Task.Delay(1);
                    }
                }
            }
        }

        public double GetDurationSeconds(string filePath)
        {
            using (var capture = new VideoCapture(filePath))
            {
                if (!capture.IsOpened())
                    return 0;

                double fps = capture.Fps;
                double frameCount = capture.FrameCount;

                if (fps <= 0 || frameCount <= 0)
                    return 0;

                return frameCount / fps;
            }
        }
    }
}
