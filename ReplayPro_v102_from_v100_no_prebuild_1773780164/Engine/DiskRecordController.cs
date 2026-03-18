using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using OpenCvSharp;
using ReplayPro.Core;

namespace ReplayPro.Engine
{
    public class DiskRecordController : IDisposable
    {
        private readonly DiskReplaySettings settings;
        private SegmentRecorder? cam1Recorder;
        private SegmentRecorder? cam2Recorder;
        private SegmentIndex? segmentIndex;

        private readonly ConcurrentQueue<Mat> cam1Queue = new ConcurrentQueue<Mat>();
        private readonly ConcurrentQueue<Mat> cam2Queue = new ConcurrentQueue<Mat>();
        private CancellationTokenSource? writerCancellation;
        private Task? cam1WriterTask;
        private Task? cam2WriterTask;
        private int cam1TrimCounter = 0;
        private int cam2TrimCounter = 0;

        public bool IsRecording { get; private set; }

        public DiskRecordController(DiskReplaySettings settings)
        {
            this.settings = settings;
        }

        public void Start()
        {
            if (IsRecording)
                return;

            Directory.CreateDirectory(settings.ReplayBufferFolder);
            cam1Recorder = new SegmentRecorder(settings.ReplayBufferFolder, "Cam1", settings.Fps, settings.SegmentSeconds);
            cam2Recorder = new SegmentRecorder(settings.ReplayBufferFolder, "Cam2", settings.Fps, settings.SegmentSeconds);
            segmentIndex = new SegmentIndex(settings.ReplayBufferFolder);

            writerCancellation = new CancellationTokenSource();
            cam1WriterTask = Task.Run(() => WriterLoop(cam1Queue, cam1Recorder, "Cam1", () => cam1TrimCounter++, writerCancellation.Token));
            cam2WriterTask = Task.Run(() => WriterLoop(cam2Queue, cam2Recorder, "Cam2", () => cam2TrimCounter++, writerCancellation.Token));

            IsRecording = true;
        }

        public void Stop()
        {
            if (!IsRecording)
                return;

            IsRecording = false;

            try
            {
                writerCancellation?.Cancel();
            }
            catch
            {
            }

            try
            {
                cam1WriterTask?.Wait(1000);
                cam2WriterTask?.Wait(1000);
            }
            catch
            {
            }

            DrainQueue(cam1Queue);
            DrainQueue(cam2Queue);

            cam1Recorder?.Dispose();
            cam2Recorder?.Dispose();
            cam1Recorder = null;
            cam2Recorder = null;
            writerCancellation?.Dispose();
            writerCancellation = null;
            cam1WriterTask = null;
            cam2WriterTask = null;
        }

        public void AppendCamera1Frame(Mat frame)
        {
            if (!IsRecording || cam1Recorder == null || frame == null || frame.Empty())
                return;

            try
            {
                cam1Queue.Enqueue(frame.Clone());
            }
            catch
            {
            }
        }

        public void AppendCamera2Frame(Mat frame)
        {
            if (!IsRecording || cam2Recorder == null || frame == null || frame.Empty())
                return;

            try
            {
                cam2Queue.Enqueue(frame.Clone());
            }
            catch
            {
            }
        }

        private async Task WriterLoop(ConcurrentQueue<Mat> queue, SegmentRecorder recorder, string cameraName, Action tickTrimCounter, CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    if (!queue.TryDequeue(out var frame))
                    {
                        await Task.Delay(4, token);
                        continue;
                    }

                    using (frame)
                    {
                        if (!frame.Empty() && frame.Width > 0 && frame.Height > 0)
                        {
                            recorder.AppendFrame(frame);
                            tickTrimCounter();

                            if ((cameraName == "Cam1" ? cam1TrimCounter : cam2TrimCounter) % 30 == 0)
                                segmentIndex?.TrimOldSegments(cameraName, settings.BufferMinutes);
                        }
                    }
                }
                catch (TaskCanceledException)
                {
                    break;
                }
                catch
                {
                    await Task.Delay(10, token);
                }
            }
        }

        private void DrainQueue(ConcurrentQueue<Mat> queue)
        {
            while (queue.TryDequeue(out var frame))
            {
                try
                {
                    frame.Dispose();
                }
                catch
                {
                }
            }
        }

        public void Dispose()
        {
            Stop();
        }
    }
}
