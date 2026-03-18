using System.Threading;
using System.Threading.Tasks;
using OpenCvSharp;
using ReplayPro.Core;

namespace ReplayPro.Engine
{
    public class CameraCaptureWorker
    {
        private readonly FrameRingBuffer buffer;
        private VideoCapture capture;
        private CancellationTokenSource cancellation;
        private Task captureTask;
        private readonly int cameraIndex;
        private int consecutiveEmptyFrames = 0;
        private readonly object latestFrameLock = new object();

        public int CameraId { get; }
        public Mat LatestFrame { get; private set; }
        public int RequestedWidth { get; }
        public int RequestedHeight { get; }
        public int RequestedFps { get; }
        public int ActualWidth => capture != null ? (int)capture.Get(VideoCaptureProperties.FrameWidth) : 0;
        public int ActualHeight => capture != null ? (int)capture.Get(VideoCaptureProperties.FrameHeight) : 0;
        public double ActualFps => capture != null ? capture.Get(VideoCaptureProperties.Fps) : 0;

        public CameraCaptureWorker(int cameraIndex, FrameRingBuffer frameBuffer, int cameraId, int requestedWidth, int requestedHeight, int requestedFps)
        {
            buffer = frameBuffer;
            this.cameraIndex = cameraIndex;
            CameraId = cameraId;
            RequestedWidth = requestedWidth;
            RequestedHeight = requestedHeight;
            RequestedFps = requestedFps;

            capture = OpenCapture(cameraIndex, requestedWidth, requestedHeight, requestedFps);
            cancellation = new CancellationTokenSource();
            captureTask = Task.Run(() => CaptureLoop(cancellation.Token));
        }

        private VideoCapture OpenCapture(int cameraIndex, int requestedWidth, int requestedHeight, int requestedFps)
        {
            var vc = new VideoCapture(cameraIndex);

            if (vc != null && vc.IsOpened())
            {
                try
                {
                    if (requestedWidth > 0)
                        vc.Set(VideoCaptureProperties.FrameWidth, requestedWidth);
                    if (requestedHeight > 0)
                        vc.Set(VideoCaptureProperties.FrameHeight, requestedHeight);
                    if (requestedFps > 0)
                        vc.Set(VideoCaptureProperties.Fps, requestedFps);
                }
                catch
                {
                }
            }

            return vc;
        }

        private void ReopenCapture()
        {
            try
            {
                capture?.Release();
                capture?.Dispose();
            }
            catch
            {
            }

            capture = OpenCapture(cameraIndex, RequestedWidth, RequestedHeight, RequestedFps);
            consecutiveEmptyFrames = 0;
        }

        private async Task CaptureLoop(CancellationToken token)
        {
            using var frame = new Mat();

            while (!token.IsCancellationRequested)
            {
                try
                {
                    if (capture == null || !capture.IsOpened())
                    {
                        ReopenCapture();
                        await Task.Delay(100, token);
                        continue;
                    }

                    bool ok = capture.Read(frame);

                    if (!ok || frame == null || frame.Empty() || frame.Width <= 0 || frame.Height <= 0)
                    {
                        consecutiveEmptyFrames++;
                        if (consecutiveEmptyFrames >= 10)
                            ReopenCapture();

                        await Task.Delay(10, token);
                        continue;
                    }

                    consecutiveEmptyFrames = 0;

                    var latestClone = frame.Clone();
                    var bufferClone = frame.Clone();

                    Mat? oldLatest = null;
                    lock (latestFrameLock)
                    {
                        oldLatest = LatestFrame;
                        LatestFrame = latestClone;
                    }

                    try
                    {
                        oldLatest?.Dispose();
                    }
                    catch { }

                    buffer.Add(new FramePacket
                    {
                        Frame = bufferClone,
                        TimestampUtc = System.DateTime.UtcNow,
                        CameraId = CameraId
                    });

                    await Task.Delay(1, token);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
                catch
                {
                    await Task.Delay(20, token);
                }
            }
        }


        public Mat? TryGetLatestFrameClone()
        {
            lock (latestFrameLock)
            {
                if (LatestFrame == null || LatestFrame.Empty() || LatestFrame.Width <= 0 || LatestFrame.Height <= 0)
                    return null;

                try
                {
                    return LatestFrame.Clone();
                }
                catch
                {
                    return null;
                }
            }
        }

        public void Stop()
        {
            try
            {
                if (cancellation != null && !cancellation.IsCancellationRequested)
                    cancellation.Cancel();
            }
            catch { }

            try
            {
                if (captureTask != null)
                    captureTask.Wait(500);
            }
            catch { }

            try
            {
                LatestFrame?.Dispose();
            }
            catch { }

            try
            {
                capture?.Release();
                capture?.Dispose();
            }
            catch { }
        }
    }
}
