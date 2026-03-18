using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Media.Imaging;
using System.Windows.Input;
using System.Windows.Threading;
using OpenCvSharp;
using Forms = System.Windows.Forms;

namespace ReplayPro
{
    public partial class MainWindow : System.Windows.Window
    {
        private enum OutputMode
        {
            Live,
            Replay,
            Imported
        }

        private readonly ReplayPro.Core.AppSettings settings = new ReplayPro.Core.AppSettings();
        private ReplayPro.Engine.FrameRingBuffer buffer1 = null!;
        private ReplayPro.Engine.FrameRingBuffer buffer2 = null!;
        private ReplayPro.Engine.CameraCaptureWorker? cam1;
        private ReplayPro.Engine.CameraCaptureWorker? cam2;
        private readonly ReplayPro.Engine.ReplayCoordinator coordinator = new ReplayPro.Engine.ReplayCoordinator();
        private readonly ReplayPro.Engine.ReplayPlayer replay = new ReplayPro.Engine.ReplayPlayer();
        private readonly ReplayPro.Engine.ExportService exportService = new ReplayPro.Engine.ExportService();
        private readonly ReplayPro.Engine.ClipLibrary clipLibrary = new ReplayPro.Engine.ClipLibrary();
        private readonly ReplayPro.Engine.MediaPlaybackService mediaPlayback = new ReplayPro.Engine.MediaPlaybackService();
        private readonly ReplayPro.Engine.CameraDiscoveryService cameraDiscoveryService = new ReplayPro.Engine.CameraDiscoveryService();
        private readonly ReplayPro.Engine.ShuttleInputService shuttleInputService = new ReplayPro.Engine.ShuttleInputService();
        private readonly ReplayPro.Core.DiskReplaySettings diskReplaySettings = new ReplayPro.Core.DiskReplaySettings();
        private ReplayPro.Engine.DiskRecordController? diskRecordController;
        private List<ReplayPro.Engine.CameraDeviceInfo> availableCameras = new();
        private readonly List<string> inputModes = new()
        {
            "1920x1080@50",
            "1920x1080@30",
            "1280x720@50",
            "1280x720@30"
        };

        private DispatcherTimer liveRenderTimer = null!;
        private DispatcherTimer virtualShuttleTimer = null!;
        private IProgramOutputSink? pgmWindow;

        private List<ReplayPro.Core.FramePacket>? replayFramesCam1;
        private List<ReplayPro.Core.FramePacket>? replayFramesCam2;

        private OutputMode currentMode = OutputMode.Live;
        private int playbackToken = 0;
        private int clipCounter = 1;
        private int playheadFrameIndex = 0;
        private int currentFrameIndex = 0;
        private int markInFrame = 0;
        private int markOutFrame = -1;
        private string markInDisplayTimecode = "00:00:00:00";
        private string markOutDisplayTimecode = "--:--:--:--";
        private double replaySpeed = 1.0;
        private int virtualShuttleSpeed = 0;
        private double virtualShuttleAccumulator = 0;
        private bool replaySessionActive = false;
        private int loopAFrame = -1;
        private int loopBFrame = -1;
        private bool isLoopPlaying = false;
        private DispatcherTimer abLoopTimer = null!;
        private int lastTimelineFrameIndex = -999999;
        private bool lastTimelineLiveState = true;
        private bool lastRecordingIndicatorState = false;
        private readonly ReplayPro.Core.ClipItem?[] clipBank = new ReplayPro.Core.ClipItem?[4];
        private DispatcherTimer replayCountdownTimer = null!;
        private readonly HashSet<int> playlistSelection = new HashSet<int>();
        private int replayCountdownValue = 0;
        private bool isTimelineDragging = false;
        private bool isSelectedClipPlaying = false;
        private int selectedClipPlaybackToken = 0;
        private bool isAutoReplayBusy = false;
        private readonly object autoReplayLock = new object();
        private readonly System.Threading.SemaphoreSlim replayQueueSemaphore = new System.Threading.SemaphoreSlim(1, 1);
        private bool isReplayQueueBusy = false;
        private readonly System.Collections.Concurrent.ConcurrentQueue<ReplayPro.Core.ClipItem> clipSaveQueue = new System.Collections.Concurrent.ConcurrentQueue<ReplayPro.Core.ClipItem>();
        private bool isClipSaveBusy = false;


private bool TryBeginAutoReplay()
{
    lock (autoReplayLock)
    {
        if (isAutoReplayBusy)
            return false;

        isAutoReplayBusy = true;
        return true;
    }
}

private void EndAutoReplay()
{
    lock (autoReplayLock)
    {
        isAutoReplayBusy = false;
    }
}


private bool TryBeginReplayQueue()
{
    if (isReplayQueueBusy)
        return false;

    isReplayQueueBusy = true;
    return true;
}

private void EndReplayQueue()
{
    isReplayQueueBusy = false;
}

private async System.Threading.Tasks.Task PlayReplayRequestAsync(
    System.Collections.Generic.List<ReplayPro.Core.FramePacket> selection,
    string stateText,
    string finishedStatus)
{
    if (selection == null || selection.Count == 0)
        return;

    await replayQueueSemaphore.WaitAsync();
    try
    {
        playbackToken++;
        int token = playbackToken;
        currentMode = OutputMode.Replay;
        ProgramStateText.Text = stateText;

        await PlayReplaySelectionSmoothAsync(selection, token, stateText);

        if (token == playbackToken)
            HoldOnCurrentProgramFrame("HOLD", finishedStatus);
    }
    finally
    {
        replayQueueSemaphore.Release();
    }
}


private void QueueReplayClipSave(ReplayPro.Core.ClipItem clip)
{
    if (clip == null || clip.Frames == null || clip.Frames.Count == 0)
        return;

    clipSaveQueue.Enqueue(clip);
    _ = ProcessClipSaveQueueAsync();
}

private async System.Threading.Tasks.Task ProcessClipSaveQueueAsync()
{
    if (isClipSaveBusy)
        return;

    isClipSaveBusy = true;
    try
    {
        while (clipSaveQueue.TryDequeue(out var clip))
        {
            await RegisterReplayClipAsync(clip);
            await Dispatcher.BeginInvoke(new Action(() =>
            {
                SetStatus("Status: Replay clip saved to library");
            }));
        }
    }
    catch
    {
        await Dispatcher.BeginInvoke(new Action(() =>
        {
            SetStatus("Status: Replay clip library save failed");
        }));
    }
    finally
    {
        isClipSaveBusy = false;
    }
}

private int GetReplayFrameDelayMs()
{
    if (replaySpeed <= 0.5)
        return 40;
    return 20;
}

        public MainWindow()
        {
            InitializeComponent();

            CreateCameraWorkers(settings.Camera1Index, settings.Camera2Index, settings.Camera1Mode, settings.Camera2Mode);
            LoadCameraSelectors();
            InitializeTimers();
            RefreshClipList();
            UpdateInOutTexts();
            UpdateSpeedButtons();
            SyncDiskSettings();
            diskRecordController = new ReplayPro.Engine.DiskRecordController(diskReplaySettings);
            UpdateStorageUi();
            UpdateRecordUi();
            UpdateRecordingIndicatorUi();
            UpdateReplayTimelineUi();
            WireShuttleEvents();

            Loaded += MainWindow_Loaded;
            Closing += MainWindow_Closing;
            PreviewKeyDown += MainWindow_PreviewKeyDown;
            PreviewKeyDown += InstantReplayHotkeys_PreviewKeyDown;
        }


private void WireShuttleEvents()
{
    shuttleInputService.ReplayPressed += () => Dispatcher.Invoke(() => ReplaySelected_Click(this, new RoutedEventArgs()));
    shuttleInputService.MarkInPressed += () => Dispatcher.Invoke(() => MarkIn_Click(this, new RoutedEventArgs()));
    shuttleInputService.MarkOutPressed += () => Dispatcher.Invoke(() => MarkOut_Click(this, new RoutedEventArgs()));
    shuttleInputService.SaveClipPressed += () => Dispatcher.Invoke(() => SaveMarkedClip_Click(this, new RoutedEventArgs()));
    shuttleInputService.TakeLivePressed += () => Dispatcher.Invoke(() => TakeLive_Click(this, new RoutedEventArgs()));
    shuttleInputService.JogLeft += () => Dispatcher.Invoke(() => VirtualJogLeftButton_Click(this, new RoutedEventArgs()));
    shuttleInputService.JogRight += () => Dispatcher.Invoke(() => VirtualJogRightButton_Click(this, new RoutedEventArgs()));
}

private void StartShuttleIfAvailable()
{
    try
    {
        shuttleInputService.Start();

        if (shuttleInputService.IsConnected)
        {
            ShuttleStatusText.Text = "Shuttle: connected";
            DebugText.Text = "Debug: " + shuttleInputService.DetectedDeviceName;
            SetStatus("Status: Shuttle connected (HID mode)");
        }
        else
        {
            ShuttleStatusText.Text = "Shuttle: not detected";
            DebugText.Text = "Debug: " + shuttleInputService.DebugDeviceList;
        }
    }
    catch
    {
        ShuttleStatusText.Text = "Shuttle: start failed";
    }
}

private void UpdateStorageUi()
{
    if (ReplayBufferTextBox != null)
        ReplayBufferTextBox.Text = settings.ReplayBufferFolder;
    if (ClipStorageTextBox != null)
        ClipStorageTextBox.Text = settings.ClipStorageFolder;

    try
    {
        string root = System.IO.Path.GetPathRoot(settings.ReplayBufferFolder) ?? settings.ReplayBufferFolder;
        var drive = new System.IO.DriveInfo(root);
        double freeGb = drive.AvailableFreeSpace / 1024d / 1024d / 1024d;
        StorageInfoText.Text = "Free space: " + freeGb.ToString("0.0") + " GB";
    }
    catch
    {
        StorageInfoText.Text = "Free space: unavailable";
    }
}

private void BrowseClipStorageButton_Click(object sender, RoutedEventArgs e)
{
    using var dialog = new Forms.FolderBrowserDialog();
    dialog.Description = "Choose clip storage folder";
    dialog.SelectedPath = settings.ClipStorageFolder;

    if (dialog.ShowDialog() == Forms.DialogResult.OK && !string.IsNullOrWhiteSpace(dialog.SelectedPath))
    {
        settings.ClipStorageFolder = dialog.SelectedPath;
        UpdateStorageUi();
        SetStatus("Status: Clip storage set");
    }
}


private void SyncDiskSettings()
{
    diskReplaySettings.ReplayBufferFolder = settings.ReplayBufferFolder;
    diskReplaySettings.BufferMinutes = settings.ReplayBufferMinutes;
    diskReplaySettings.SegmentSeconds = settings.SegmentSeconds;
    diskReplaySettings.Fps = settings.FPS;
}

private void UpdateRecordUi()
{
    if (BufferMinutesComboBox != null)
        BufferMinutesComboBox.SelectedIndex = settings.ReplayBufferMinutes == 1 ? 0 :
                                              settings.ReplayBufferMinutes == 3 ? 1 :
                                              settings.ReplayBufferMinutes == 10 ? 3 : 2;

    if (RecordStatusText != null)
        RecordStatusText.Text = diskRecordController != null && diskRecordController.IsRecording ? "REC ON" : "REC OFF";
}

private void BrowseReplayBufferButton_Click(object sender, RoutedEventArgs e)
{
    using var dialog = new Forms.FolderBrowserDialog();
    dialog.Description = "Choose replay buffer folder";
    dialog.SelectedPath = settings.ReplayBufferFolder;

    if (dialog.ShowDialog() == Forms.DialogResult.OK && !string.IsNullOrWhiteSpace(dialog.SelectedPath))
    {
        settings.ReplayBufferFolder = dialog.SelectedPath;
        SyncDiskSettings();
        UpdateStorageUi();
        SetStatus("Status: Replay buffer folder set");
    }
}

private void StartRecordButton_Click(object sender, RoutedEventArgs e)
{
    if (BufferMinutesComboBox?.SelectedItem is System.Windows.Controls.ComboBoxItem item &&
        int.TryParse(item.Content?.ToString(), out int mins))
    {
        settings.ReplayBufferMinutes = mins;
    }

    SyncDiskSettings();

    diskRecordController ??= new ReplayPro.Engine.DiskRecordController(diskReplaySettings);
    diskRecordController.Start();
    UpdateRecordUi();
    UpdateRecordingIndicatorUi();
    SetStatus("Status: Recording to replay disk");
}

private void StopRecordButton_Click(object sender, RoutedEventArgs e)
{
    diskRecordController?.Stop();
    UpdateRecordUi();
    UpdateRecordingIndicatorUi();
    SetStatus("Status: Recording stopped");
}

private void AutoSaveClipToDisk(ReplayPro.Core.ClipItem clip)
{
    if (clip.Frames == null || clip.Frames.Count == 0)
        return;

    try
    {
        string datedFolder = System.IO.Path.Combine(settings.ClipStorageFolder, System.DateTime.Now.ToString("yyyy-MM-dd"));
        exportService.ExportReplay(clip.Frames, datedFolder, settings.FPS, clip.Name);
    }
    catch
    {
    }
}



private System.Collections.Generic.List<ReplayPro.Core.FramePacket> BuildReplaySelectionFast(int seconds)
{
    int replayFrames = seconds * settings.FPS;

    var frames = coordinator.ProgramCamera == 1
        ? buffer1.GetLatestRangeReferences(replayFrames)
        : buffer2.GetLatestRangeReferences(replayFrames);

    return frames.Where(fp => fp?.Frame != null && !fp.Frame.Empty()).ToList();
}




private async System.Threading.Tasks.Task RegisterReplayClipAsync(ReplayPro.Core.ClipItem clip)
{
    if (clip == null || clip.Frames == null || clip.Frames.Count == 0)
        return;

    var safeFrames = await System.Threading.Tasks.Task.Run(() =>
    {
        var list = new System.Collections.Generic.List<ReplayPro.Core.FramePacket>(clip.Frames.Count);

        foreach (var fp in clip.Frames)
        {
            if (fp?.Frame == null || fp.Frame.Empty())
                continue;

            try
            {
                list.Add(new ReplayPro.Core.FramePacket
                {
                    Frame = fp.Frame.Clone(),
                    TimestampUtc = fp.TimestampUtc,
                    CameraId = fp.CameraId
                });
            }
            catch
            {
            }
        }

        return list;
    });

    if (safeFrames.Count == 0)
        return;

    var safeClip = new ReplayPro.Core.ClipItem
    {
        Name = clip.Name,
        CreatedAt = clip.CreatedAt,
        CameraSource = clip.CameraSource,
        Frames = safeFrames,
        IsImportedMedia = clip.IsImportedMedia,
        ImportedFile = clip.ImportedFile,
        DurationSeconds = clip.DurationSeconds,
        Notes = clip.Notes
    };

    await Dispatcher.BeginInvoke(new Action(() =>
    {
        clipLibrary.AddClip(safeClip);
        RefreshClipList();
        ClipListBox.SelectedIndex = ClipListBox.Items.Count - 1;
    }));
}


private async System.Threading.Tasks.Task<(System.Collections.Generic.List<ReplayPro.Core.FramePacket> Selection, ReplayPro.Core.ClipItem Clip)> BuildReplayRequestAsync(int seconds, string clipNamePrefix)
{
    return await System.Threading.Tasks.Task.Run(() =>
    {
        var frames = GetProgramBufferSnapshot();
        if (frames.Count == 0)
            return (new System.Collections.Generic.List<ReplayPro.Core.FramePacket>(), new ReplayPro.Core.ClipItem());

        int replayFrames = seconds * settings.FPS;
        int start = Math.Max(0, frames.Count - replayFrames);
        var selection = frames.Skip(start).Take(replayFrames).Where(fp => fp?.Frame != null && !fp.Frame.Empty()).ToList();

        string name = clipNamePrefix + " " + clipCounter.ToString("000");
        var clip = new ReplayPro.Core.ClipItem
        {
            Name = name,
            CreatedAt = DateTime.Now,
            CameraSource = coordinator.ProgramCamera,
            Frames = selection
        };

        return (selection, clip);
    });
}

private void MainWindow_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
{
    if (e.OriginalSource == SelectedClipNoteTextBox)
        return;

    switch (e.Key)
    {
        case System.Windows.Input.Key.I:
            MarkIn_Click(this, new RoutedEventArgs());
            e.Handled = true;
            break;
        case System.Windows.Input.Key.O:
            MarkOut_Click(this, new RoutedEventArgs());
            e.Handled = true;
            break;
        case System.Windows.Input.Key.S:
            SaveMarkedClip_Click(this, new RoutedEventArgs());
            e.Handled = true;
            break;
        case System.Windows.Input.Key.J:
            VirtualJogLeftButton_Click(this, new RoutedEventArgs());
            e.Handled = true;
            break;
        case System.Windows.Input.Key.L:
            VirtualJogRightButton_Click(this, new RoutedEventArgs());
            e.Handled = true;
            break;
        case System.Windows.Input.Key.Space:
            ReplaySelected_Click(this, new RoutedEventArgs());
            e.Handled = true;
            break;
    }
}

        private void MainWindow_Loaded(object? sender, RoutedEventArgs e)
        {
            SetStatus("Status: GUI started. Camera selectors visible. Shortcuts: I O S J L Space");
            liveRenderTimer.Start();
            UpdateStorageUi();
            UpdateRecordUi();
            UpdateRecordingIndicatorUi();
            UpdateReplayTimelineUi();
            StartShuttleIfAvailable();
        }

        private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            liveRenderTimer.Stop();
            virtualShuttleTimer.Stop();
            abLoopTimer.Stop();
            cam1?.Stop();
            cam2?.Stop();
            diskRecordController?.Dispose();
            pgmWindow?.Close();
        }

        private void InitializeTimers()
        {
            liveRenderTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(40)
            };
            liveRenderTimer.Tick += LiveRenderTimer_Tick;

            virtualShuttleTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(33)
            };
            virtualShuttleTimer.Tick += VirtualShuttleTimer_Tick;

            abLoopTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(33)
            };
            abLoopTimer.Tick += AbLoopTimer_Tick;
                    replayCountdownTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(350)
            };
            replayCountdownTimer.Tick += ReplayCountdownTimer_Tick;
}

        private void CreateCameraWorkers(int cam1Index, int cam2Index, string cam1Mode, string cam2Mode)
        {
            cam1?.Stop();
            cam2?.Stop();

            var m1 = ParseInputMode(cam1Mode);
            var m2 = ParseInputMode(cam2Mode);

            buffer1 = new ReplayPro.Engine.FrameRingBuffer(settings.FPS * settings.ReplaySeconds);
            buffer2 = new ReplayPro.Engine.FrameRingBuffer(settings.FPS * settings.ReplaySeconds);

            cam1 = new ReplayPro.Engine.CameraCaptureWorker(cam1Index, buffer1, 1, m1.width, m1.height, m1.fps);
            cam2 = new ReplayPro.Engine.CameraCaptureWorker(cam2Index, buffer2, 2, m2.width, m2.height, m2.fps);

            UpdateActualInputModeTexts();
        }

        
private (int width, int height, int fps) ParseInputMode(string? mode)
{
    if (string.IsNullOrWhiteSpace(mode))
        return (1920, 1080, 50);

    try
    {
        var parts = mode.Split('@');
        var size = parts[0].Split('x');
        int width = int.Parse(size[0]);
        int height = int.Parse(size[1]);
        int fps = parts.Length > 1 ? int.Parse(parts[1]) : 50;
        return (width, height, fps);
    }
    catch
    {
        return (1920, 1080, 50);
    }
}

private void UpdateActualInputModeTexts()
{
    if (Camera1ActualModeText != null)
    {
        string text = cam1 != null ? $"Actual: {cam1.ActualWidth}x{cam1.ActualHeight} @ {cam1.ActualFps:0}" : "Actual: -";
        Camera1ActualModeText.Text = text;
    }

    if (Camera2ActualModeText != null)
    {
        string text = cam2 != null ? $"Actual: {cam2.ActualWidth}x{cam2.ActualHeight} @ {cam2.ActualFps:0}" : "Actual: -";
        Camera2ActualModeText.Text = text;
    }
}

private void LoadCameraSelectors()
        {
            availableCameras = cameraDiscoveryService.GetVideoDevices();

            Camera1ComboBox.ItemsSource = availableCameras;
            Camera2ComboBox.ItemsSource = availableCameras;

            Camera1ModeComboBox.ItemsSource = inputModes;
            Camera2ModeComboBox.ItemsSource = inputModes;

            if (availableCameras.Count > 0)
            {
                Camera1ComboBox.SelectedIndex = Math.Min(settings.Camera1Index, availableCameras.Count - 1);
                Camera2ComboBox.SelectedIndex = Math.Min(settings.Camera2Index, availableCameras.Count - 1);
            }

            Camera1ModeComboBox.SelectedItem = inputModes.Contains(settings.Camera1Mode) ? settings.Camera1Mode : inputModes[0];
            Camera2ModeComboBox.SelectedItem = inputModes.Contains(settings.Camera2Mode) ? settings.Camera2Mode : inputModes[0];

            UpdateActualInputModeTexts();
        }

        private void LiveRenderTimer_Tick(object? sender, EventArgs e)
        {
            if (isSelectedClipPlaying || isLoopPlaying || isTimelineDragging)
                return;

            if (currentMode != OutputMode.Live)
                return;

            using var live1 = cam1?.TryGetLatestFrameClone();
            using var live2 = cam2?.TryGetLatestFrameClone();

            var img1 = SnapshotPreviewImage(live1);
            var img2 = SnapshotPreviewImage(live2);

            if (img1 != null)
                Camera1Preview.Source = img1;
            if (img2 != null)
                Camera2Preview.Source = img2;

            if (diskRecordController != null && diskRecordController.IsRecording)
            {
                try
                {
                    if (live1 != null && !live1.Empty())
                        diskRecordController.AppendCamera1Frame(live1);
                    if (live2 != null && !live2.Empty())
                        diskRecordController.AppendCamera2Frame(live2);
                }
                catch
                {
                }
            }

            var pgmImg = coordinator.ProgramCamera == 1 ? img1 : img2;
            if (pgmImg != null)
                ProgramCameraPreview.Source = pgmImg;

            try
            {
                if (pgmImg != null)
                {
                    pgmWindow?.SetFrame(pgmImg);
                }
            }
            catch
            {
                if (pgmImg != null)
                    pgmWindow?.SetFrame(pgmImg);
            }

            string tc = CurrentClockTimecode();
            ProgramStateText.Text = "LIVE";
            ProgramMarkText.Text = "LIVE";
            ProgramFrameCounterText.Text = "Frame: Live";
            ProgramTimecodeText.Text = "TC: " + tc;
            Cam1TimecodeText.Text = "TC: " + tc;
            Cam2TimecodeText.Text = "TC: " + tc;
            UpdateRecordingIndicatorUi();
            UpdateReplayTimelineUi();
        }

        private BitmapImage? SnapshotPreviewImage(Mat? source)
{
    if (source == null || source.Empty() || source.Width <= 0 || source.Height <= 0)
        return null;

    try
    {
        using var resized = new Mat();
        Cv2.Resize(source, resized, new OpenCvSharp.Size(960, 540), 0, 0, InterpolationFlags.Linear);
        return ConvertMat(resized);
    }
    catch
    {
        return null;
    }
}
private Mat PrepareHdmiFrame(Mat source)
{
    // Conservative 1080i50 -> 720p progressive path.
    // Reduces interlace harshness by vertically blending before final scale.
    if (source == null || source.Empty() || source.Width <= 0 || source.Height <= 0)
        return new Mat();

    var result = new Mat();

    if (source.Height >= 1000)
    {
        using var half = new Mat();
        Cv2.Resize(source, half, new OpenCvSharp.Size(source.Width, source.Height / 2), 0, 0, InterpolationFlags.Area);
        Cv2.Resize(half, result, new OpenCvSharp.Size(1280, 720), 0, 0, InterpolationFlags.Lanczos4);
    }
    else
    {
        Cv2.Resize(source, result, new OpenCvSharp.Size(1280, 720), 0, 0, InterpolationFlags.Lanczos4);
    }

    return result;
}


        private BitmapImage ConvertMat(Mat mat)
        {
            if (mat == null || mat.Empty() || mat.Width <= 0 || mat.Height <= 0)
                return new BitmapImage();

            Cv2.ImEncode(".bmp", mat, out byte[] imageData);
            using var memoryStream = new MemoryStream(imageData);
            BitmapImage bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = memoryStream;
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }

        private string CurrentClockTimecode()
        {
            var now = DateTime.Now;
            int frame = (int)(now.Millisecond / (1000.0 / settings.FPS));
            if (frame >= settings.FPS)
                frame = settings.FPS - 1;

            return now.ToString("HH:mm:ss") + ":" + frame.ToString("00");
        }

        private string FrameToTimecode(int frame)
        {
            if (frame < 0)
                frame = 0;

            int totalSeconds = frame / settings.FPS;
            int ff = frame % settings.FPS;
            int hh = totalSeconds / 3600;
            int mm = (totalSeconds % 3600) / 60;
            int ss = totalSeconds % 60;

            return hh.ToString("00") + ":" + mm.ToString("00") + ":" + ss.ToString("00") + ":" + ff.ToString("00");
        }


private void UpdateReplayTimelineUi()
{
    if (ReplayPlayheadText == null || ReplayTimelineFill == null || ReplayPlayheadMarker == null)
        return;

    int maxFrames = replayFramesCam1 != null && replayFramesCam2 != null
        ? System.Math.Min(replayFramesCam1.Count, replayFramesCam2.Count)
        : 0;

    bool isLive = currentMode == OutputMode.Live || maxFrames <= 0;
    int effectiveFrame = isLive ? -1 : playheadFrameIndex;

    if (effectiveFrame == lastTimelineFrameIndex && isLive == lastTimelineLiveState)
        return;

    lastTimelineFrameIndex = effectiveFrame;
    lastTimelineLiveState = isLive;

    double trackWidth = ReplayTimelineTrackBorder != null && ReplayTimelineTrackBorder.ActualWidth > 1
        ? ReplayTimelineTrackBorder.ActualWidth - 6
        : 860.0;

    if (isLive)
    {
        ReplayPlayheadText.Text = "Playhead: LIVE";
        ReplayTimelineFill.Width = 0;
        ReplayPlayheadMarker.Margin = new Thickness(0, -4, 0, 0);
        ReplayTimelineLeftText.Text = "OLD";
        ReplayTimelineRightText.Text = "LIVE";
        if (ReplayBufferLengthText != null)
            ReplayBufferLengthText.Text = "Buffer: 00:00 / 00:00";
        if (LoopRangeText != null)
            LoopRangeText.Text = "Loop: A --  B --";
        if (LoopABar != null)
        {
            LoopABar.Width = 0;
            LoopABar.Margin = new Thickness(0, 0, 0, 0);
        }
        return;
    }

    double ratio = maxFrames > 1 ? (double)playheadFrameIndex / (maxFrames - 1) : 0.0;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    double pos = ratio * trackWidth;
    ReplayTimelineFill.Width = pos;
    ReplayPlayheadMarker.Margin = new Thickness(pos, -4, 0, 0);

    int currentSecs = playheadFrameIndex / settings.FPS;
    int totalSecs = maxFrames / settings.FPS;

    ReplayPlayheadText.Text = "Playhead: " + FrameToTimecode(playheadFrameIndex);
    ReplayTimelineLeftText.Text = "OLD";
    ReplayTimelineRightText.Text = "LIVE";
    if (ReplayBufferLengthText != null)
        ReplayBufferLengthText.Text = "Buffer: " + currentSecs.ToString("00") + "s / " + totalSecs.ToString("00") + "s";

    if (LoopRangeText != null)
    {
        string aText = loopAFrame >= 0 ? FrameToTimecode(loopAFrame) : "--";
        string bText = loopBFrame >= 0 ? FrameToTimecode(loopBFrame) : "--";
        LoopRangeText.Text = "Loop: A " + aText + "  B " + bText + (isLoopPlaying ? "  PLAY" : "");
    }

    if (LoopABar != null)
    {
        if (loopAFrame >= 0 && loopBFrame > loopAFrame && maxFrames > 1)
        {
            double aPos = ((double)loopAFrame / (maxFrames - 1)) * trackWidth;
            double bPos = ((double)loopBFrame / (maxFrames - 1)) * trackWidth;
            LoopABar.Width = Math.Max(4, bPos - aPos);
            LoopABar.Margin = new Thickness(aPos, 0, 0, 0);
        }
        else
        {
            LoopABar.Width = 0;
            LoopABar.Margin = new Thickness(0, 0, 0, 0);
        }
    }
}


private void ReplayTimelineTrack_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
{
    isTimelineDragging = true;
    ReplayTimelineTrackBorder.CaptureMouse();
    MovePlayheadFromTimelinePosition(e.GetPosition(ReplayTimelineTrackBorder).X);
    SetStatus("Status: Playhead moved");
}

private void SetLoopAButton_Click(object sender, RoutedEventArgs e)
{
    BeginReplaySession();
    if (GetDualMaxFrames() <= 0)
        return;

    loopAFrame = playheadFrameIndex;
    if (loopBFrame >= 0 && loopBFrame < loopAFrame)
    {
        int tmp = loopAFrame;
        loopAFrame = loopBFrame;
        loopBFrame = tmp;
    }

    UpdateReplayTimelineUi();
    SetStatus("Status: Loop A set");
}

private void SetLoopBButton_Click(object sender, RoutedEventArgs e)
{
    BeginReplaySession();
    if (GetDualMaxFrames() <= 0)
        return;

    loopBFrame = playheadFrameIndex;
    if (loopAFrame >= 0 && loopBFrame < loopAFrame)
    {
        int tmp = loopAFrame;
        loopAFrame = loopBFrame;
        loopBFrame = tmp;
    }

    UpdateReplayTimelineUi();
    SetStatus("Status: Loop B set");
}

private void PlayLoopButton_Click(object sender, RoutedEventArgs e)
{
    if (loopAFrame < 0 || loopBFrame < 0 || loopBFrame <= loopAFrame)
    {
        SetStatus("Status: Set A and B first");
        return;
    }

    BeginReplaySession();
    playheadFrameIndex = loopAFrame;
    isLoopPlaying = true;
    abLoopTimer.Start();
    UpdateReplayTimelineUi();
    SetStatus("Status: A/B loop playing");
}

private void StopLoopButton_Click(object sender, RoutedEventArgs e)
{
    isLoopPlaying = false;
    abLoopTimer.Stop();
    isTimelineDragging = false;
    ReplayTimelineTrackBorder.ReleaseMouseCapture();
    UpdateReplayTimelineUi();
    SetStatus("Status: Loop stopped");
}

private void AbLoopTimer_Tick(object? sender, EventArgs e)
{
    if (!isLoopPlaying)
        return;

    if (loopAFrame < 0 || loopBFrame < 0 || loopBFrame <= loopAFrame)
    {
        isLoopPlaying = false;
        abLoopTimer.Stop();
        return;
    }

    if (!replaySessionActive)
        BeginReplaySession();

    currentMode = OutputMode.Replay;
    playheadFrameIndex += Math.Max(1, (int)Math.Round(replaySpeed));
    if (playheadFrameIndex > loopBFrame)
        playheadFrameIndex = loopAFrame;

    ClampPlayhead();
    RenderReplayFrame();
    UpdateReplayTimelineUi();
}




private void MovePlayheadFromTimelinePosition(double x)
{
    BeginReplaySession();

    int maxFrames = GetDualMaxFrames();
    if (maxFrames <= 0)
        return;

    double trackWidth = ReplayTimelineTrackBorder.ActualWidth;
    if (trackWidth <= 1)
        return;

    double ratio = x / trackWidth;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    currentMode = OutputMode.Replay;
    playheadFrameIndex = (int)Math.Round(ratio * Math.Max(0, maxFrames - 1));
    ClampPlayhead();
    RenderReplayFrame();
    UpdateReplayTimelineUi();
}

private void ReplayTimelineTrack_MouseMove(object sender, System.Windows.Input.MouseEventArgs e)
{
    if (!isTimelineDragging)
        return;

    MovePlayheadFromTimelinePosition(e.GetPosition(ReplayTimelineTrackBorder).X);
}

private void ReplayTimelineTrack_MouseLeftButtonUp(object sender, System.Windows.Input.MouseButtonEventArgs e)
{
    if (!isTimelineDragging)
        return;

    isTimelineDragging = false;
    ReplayTimelineTrackBorder.ReleaseMouseCapture();
    MovePlayheadFromTimelinePosition(e.GetPosition(ReplayTimelineTrackBorder).X);
    SetStatus("Status: Playhead dragged");
}

private void VirtualShuttleSlider_PreviewMouseLeftButtonUp(object sender, System.Windows.Input.MouseButtonEventArgs e)
{
    virtualShuttleTimer.Stop();
    virtualShuttleSpeed = 0;
    virtualShuttleAccumulator = 0;
    VirtualShuttleSlider.Value = 0;
    VirtualShuttleValueText.Text = "0x";
    SetStatus("Status: Virtual shuttle stopped");
}

private void UpdateRecordingIndicatorUi()
{
    bool recOn = diskRecordController != null && diskRecordController.IsRecording;

    if (RecordingIndicatorBorder != null)
        RecordingIndicatorBorder.Visibility = recOn ? Visibility.Visible : Visibility.Collapsed;

    if (RecordStatusText != null)
        RecordStatusText.Text = recOn ? "REC ON" : "REC OFF";
}



private void StartReplayCountdown()
{
    replayCountdownValue = 3;
    if (ReplayCountdownText != null)
        ReplayCountdownText.Text = replayCountdownValue.ToString();
    if (ReplayCountdownBorder != null)
        ReplayCountdownBorder.Visibility = Visibility.Visible;
    replayCountdownTimer.Stop();
    replayCountdownTimer.Start();
}

private void ReplayCountdownTimer_Tick(object? sender, EventArgs e)
{
    replayCountdownValue--;
    if (replayCountdownValue <= 0)
    {
        replayCountdownTimer.Stop();
        if (ReplayCountdownBorder != null)
            ReplayCountdownBorder.Visibility = Visibility.Collapsed;
        return;
    }

    if (ReplayCountdownText != null)
        ReplayCountdownText.Text = replayCountdownValue.ToString();
}

private void StoreClipToBank(int slot)
{
    var clip = clipLibrary.GetClip(ClipListBox.SelectedIndex);
    if (clip == null)
    {
        SetStatus("Status: No clip selected for bank");
        return;
    }

    clipBank[slot] = clip;
    SetStatus("Status: Stored clip in bank " + (slot + 1));
}

private async void PlayBankClip(int slot)
{
    var clip = clipBank[slot];
    if (clip == null)
    {
        SetStatus("Status: Clip bank " + (slot + 1) + " empty");
        return;
    }

    StartReplayCountdown();

    playbackToken++;
    int token = playbackToken;
    isSelectedClipPlaying = true;
    currentMode = OutputMode.Replay;
    isLoopPlaying = false;
    abLoopTimer.Stop();
    ProgramStateText.Text = "BANK";

    try
    {
        await System.Threading.Tasks.Task.Delay(1100);

        if (clip.Frames == null || clip.Frames.Count == 0)
            return;

        for (int i = 0; i < clip.Frames.Count; i++)
        {
            if (token != playbackToken)
                break;

            var framePacket = clip.Frames[i];
            if (framePacket?.Frame == null || framePacket.Frame.Empty())
                continue;

            using var clone = framePacket.Frame.Clone();
            var bitmap = ConvertMat(clone);

            Dispatcher.Invoke(() =>
            {
                ProgramCameraPreview.Source = bitmap;
                try
                {
                    using var hdmiFrame = PrepareHdmiFrame(framePacket.Frame);
                    pgmWindow?.SetFrameMat(hdmiFrame);
                }
                catch
                {
                    pgmWindow?.SetFrame(bitmap);
                }
                ProgramTimecodeText.Text = "TC: " + FrameToTimecode(i);
                ProgramFrameCounterText.Text = "Frame: " + i;
                ProgramStateText.Text = "BANK " + (slot + 1);
            });

            int delay = replaySpeed <= 0.5 ? 50 : 20;
            await System.Threading.Tasks.Task.Delay(delay);
        }
    }
    finally
    {
        if (token == playbackToken)
        {
            HoldOnCurrentProgramFrame("HOLD", "Status: Bank clip playback finished. Press TAKE LIVE");
        }
    }
}

private void StoreBank1_Click(object sender, RoutedEventArgs e) => StoreClipToBank(0);
private void StoreBank2_Click(object sender, RoutedEventArgs e) => StoreClipToBank(1);
private void StoreBank3_Click(object sender, RoutedEventArgs e) => StoreClipToBank(2);
private void StoreBank4_Click(object sender, RoutedEventArgs e) => StoreClipToBank(3);
private void PlayBank1_Click(object sender, RoutedEventArgs e) => PlayBankClip(0);
private void PlayBank2_Click(object sender, RoutedEventArgs e) => PlayBankClip(1);
private void PlayBank3_Click(object sender, RoutedEventArgs e) => PlayBankClip(2);
private void PlayBank4_Click(object sender, RoutedEventArgs e) => PlayBankClip(3);



private int GetSelectedClipIndex()
{
    if (ClipListBox.SelectedItem is System.Windows.Controls.CheckBox cb && cb.Tag is int idx)
        return idx;

    return ClipListBox.SelectedIndex;
}

private List<ReplayPro.Core.ClipItem> GetPlaylistClipsForPlayback()
{
    var selected = playlistSelection
        .OrderBy(i => i)
        .Select(i => clipLibrary.GetClip(i))
        .Where(c => c != null)
        .Cast<ReplayPro.Core.ClipItem>()
        .ToList();

    if (selected.Count > 0)
        return selected;

    int idx = GetSelectedClipIndex();
    var single = clipLibrary.GetClip(idx);
    if (single != null)
        selected.Add(single);

    return selected;
}

private void HoldOnCurrentProgramFrame(string stateText, string statusText)
{
    isSelectedClipPlaying = false;
    currentMode = OutputMode.Replay;
    ProgramStateText.Text = stateText;
    ProgramMarkText.Text = stateText;
    UpdateReplayTimelineUi();
    SetStatus(statusText);
}

private void ClipPlaylistCheckBox_Checked(object sender, RoutedEventArgs e)
{
    if (sender is System.Windows.Controls.CheckBox cb && cb.Tag is int idx)
        playlistSelection.Add(idx);
}

private void ClipPlaylistCheckBox_Unchecked(object sender, RoutedEventArgs e)
{
    if (sender is System.Windows.Controls.CheckBox cb && cb.Tag is int idx)
        playlistSelection.Remove(idx);
}

        private void SetStatus(string text)
        {
            StatusText.Text = text;
        }

        private void UpdateInOutTexts()
        {
            string text = "IN " + markInDisplayTimecode + " | OUT " + markOutDisplayTimecode;
            ProgramMarkText.Text = text;
            Cam1InOutText.Text = text;
            Cam2InOutText.Text = text;
        }

        private void UpdateSpeedButtons()
        {
            Speed50Button.Background = replaySpeed == 0.5 ? System.Windows.Media.Brushes.SteelBlue : System.Windows.Media.Brushes.DimGray;
            Speed100Button.Background = replaySpeed == 1.0 ? System.Windows.Media.Brushes.SteelBlue : System.Windows.Media.Brushes.DimGray;
        }

        private void OpenProgramOutputOnSecondScreen()
        {
            try
            {
                var screens = Forms.Screen.AllScreens;
                var targetScreen = screens.FirstOrDefault(s => !s.Primary);
                if (targetScreen == null)
                {
                    SetStatus("Status: No secondary display found for PGM output");
                    return;
                }

                pgmWindow?.Close();
                pgmWindow = new ProgramOutputWindow
                {
                    WindowStartupLocation = WindowStartupLocation.Manual,
                    Left = targetScreen.Bounds.Left,
                    Top = targetScreen.Bounds.Top,
                    Width = targetScreen.Bounds.Width,
                    Height = targetScreen.Bounds.Height,
                    WindowState = WindowState.Normal
                };
                pgmWindow.Show();
                SetStatus("Status: PGM opened on secondary display");
            }
            catch
            {
                SetStatus("Status: Could not open PGM output");
            }
        }

private void EnsureReplaySnapshots()
{
    if (replaySessionActive && replayFramesCam1 != null && replayFramesCam2 != null && GetDualMaxFrames() > 0)
        return;

    replayFramesCam1 = buffer1.Snapshot();
    replayFramesCam2 = buffer2.Snapshot();

    int maxFrames = GetDualMaxFrames();
    if (maxFrames <= 0)
    {
        playheadFrameIndex = 0;
        currentFrameIndex = 0;
        replaySessionActive = false;
        return;
    }

    playheadFrameIndex = maxFrames - 1;
    currentFrameIndex = playheadFrameIndex;
    currentMode = OutputMode.Replay;
    replaySessionActive = true;
    ProgramStateText.Text = "JOG";
    SetStatus("Status: Replay buffer locked");
}

private void BeginReplaySession()
{
    EnsureReplaySnapshots();
}

private void EndReplaySession()
{
    replaySessionActive = false;
    replayFramesCam1 = null;
    replayFramesCam2 = null;
    playheadFrameIndex = 0;
    currentFrameIndex = 0;
    virtualShuttleSpeed = 0;
    virtualShuttleAccumulator = 0;
    virtualShuttleTimer.Stop();
    if (VirtualShuttleSlider != null)
        VirtualShuttleSlider.Value = 0;
    if (VirtualShuttleValueText != null)
        VirtualShuttleValueText.Text = "0x";
}

        private int GetDualMaxFrames()
        {
            int c1 = replayFramesCam1?.Count ?? 0;
            int c2 = replayFramesCam2?.Count ?? 0;
            return Math.Min(c1, c2);
        }

        private void ClampPlayhead()
        {
            int max = GetDualMaxFrames();
            if (max <= 0)
            {
                playheadFrameIndex = 0;
                return;
            }

            if (playheadFrameIndex < 0)
                playheadFrameIndex = 0;
            if (playheadFrameIndex >= max)
                playheadFrameIndex = max - 1;
        }

        private void RenderReplayFrame()
        {
            int max = GetDualMaxFrames();
            if (max <= 0 || replayFramesCam1 == null || replayFramesCam2 == null)
            {
                SetStatus("Status: No replay buffer available");
                return;
            }

            ClampPlayhead();

            var frame1 = replayFramesCam1[playheadFrameIndex];
            var frame2 = replayFramesCam2[playheadFrameIndex];
            if (frame1?.Frame == null || frame2?.Frame == null)
                return;

            try
            {
                using var clone1 = frame1.Frame.Clone();
                using var clone2 = frame2.Frame.Clone();

                var img1 = ConvertMat(clone1);
                var img2 = ConvertMat(clone2);

                Camera1Preview.Source = img1;
                Camera2Preview.Source = img2;

                if (diskRecordController != null && diskRecordController.IsRecording)
            {
                try
                {
                    if (cam1?.LatestFrame != null)
                    {
                        using var rec1 = cam1.LatestFrame.Clone();
                        diskRecordController.AppendCamera1Frame(rec1);
                    }
                    if (cam2?.LatestFrame != null)
                    {
                        using var rec2 = cam2.LatestFrame.Clone();
                        diskRecordController.AppendCamera2Frame(rec2);
                    }
                }
                catch
                {
                }
            }

            var pgmImg = coordinator.ProgramCamera == 1 ? img1 : img2;
                ProgramCameraPreview.Source = pgmImg;

                try
                {
                    var pgmSourceFrame = coordinator.ProgramCamera == 1 ? frame1.Frame : frame2.Frame;
                    using var hdmiFrame = PrepareHdmiFrame(pgmSourceFrame);
                    pgmWindow?.SetFrameMat(hdmiFrame);
                }
                catch
                {
                    pgmWindow?.SetFrame(pgmImg);
                }

                currentFrameIndex = playheadFrameIndex;
                ProgramStateText.Text = "JOG";
                ProgramFrameCounterText.Text = "Frame: " + playheadFrameIndex;
                ProgramTimecodeText.Text = "TC: " + FrameToTimecode(playheadFrameIndex);
                Cam1TimecodeText.Text = "TC: " + FrameToTimecode(playheadFrameIndex);
                Cam2TimecodeText.Text = "TC: " + FrameToTimecode(playheadFrameIndex);
                UpdateInOutTexts();
                UpdateReplayTimelineUi();
                UpdateReplayTimelineUi();
            }
            catch
            {
                SetStatus("Status: Replay render failed");
            }
        }

private void ResetReplayState()
{
    EndReplaySession();
}

private void JogByFrames(int delta)
{
    BeginReplaySession();

    int max = GetDualMaxFrames();
    if (max <= 0)
    {
        SetStatus("Status: No dual-angle buffer to jog");
        return;
    }

    playheadFrameIndex += delta;
    ClampPlayhead();
    RenderReplayFrame();
    SetStatus("Status: Jog " + FrameToTimecode(playheadFrameIndex));
}

private void VirtualShuttleTimer_Tick(object? sender, EventArgs e)
{
    if (virtualShuttleSpeed == 0)
        return;

    if (!replaySessionActive)
        BeginReplaySession();

    if (GetDualMaxFrames() <= 0)
        return;

    virtualShuttleAccumulator += Math.Abs(virtualShuttleSpeed) switch
    {
        1 => 0.25,
        2 => 0.40,
        3 => 0.60,
        4 => 0.85,
        5 => 1.15,
        6 => 1.50,
        7 => 1.90,
        _ => 2.30
    };

    int steps = (int)virtualShuttleAccumulator;
    if (steps <= 0)
        return;

    if (steps > 3)
        steps = 3;

    virtualShuttleAccumulator -= steps;
    int dir = virtualShuttleSpeed > 0 ? 1 : -1;
    playheadFrameIndex += dir * steps;
    ClampPlayhead();
    RenderReplayFrame();
}

        private void SaveCurrentReplaySelection()
        {
            if (!replaySessionActive)
                BeginReplaySession();

            int max = GetDualMaxFrames();
            if (max <= 0 || replayFramesCam1 == null || replayFramesCam2 == null)
            {
                SetStatus("Status: No replay buffer available");
                return;
            }

            int start = markInFrame;
            int end = markOutFrame >= 0 ? markOutFrame : playheadFrameIndex;

            if (start < 0)
                start = 0;
            if (start >= max)
                start = max - 1;
            if (end < 0)
                end = 0;
            if (end >= max)
                end = max - 1;
            if (start > end)
            {
                SetStatus("Status: Invalid IN/OUT");
                return;
            }

            var selectedCam1 = replayFramesCam1.Skip(start).Take(end - start + 1).ToList();
            var selectedCam2 = replayFramesCam2.Skip(start).Take(end - start + 1).ToList();

            if (selectedCam1.Count == 0 || selectedCam2.Count == 0)
            {
                SetStatus("Status: Nothing selected to save");
                return;
            }

            string clipBase = "Dual Clip " + clipCounter.ToString("000");
            clipCounter++;

            var clip1 = new ReplayPro.Core.ClipItem
            {
                Name = clipBase + " - Cam1",
                CreatedAt = DateTime.Now,
                CameraSource = 1,
                Frames = selectedCam1
            };

            var clip2 = new ReplayPro.Core.ClipItem
            {
                Name = clipBase + " - Cam2",
                CreatedAt = DateTime.Now,
                CameraSource = 2,
                Frames = selectedCam2
            };

            clipLibrary.AddClip(clip1);
            clipLibrary.AddClip(clip2);
            AutoSaveClipToDisk(clip1);
            AutoSaveClipToDisk(clip2);

            RefreshClipList();
            if (ClipListBox.Items.Count >= 2)
                ClipListBox.SelectedIndex = ClipListBox.Items.Count - 2;

            SetStatus("Status: Saved " + clipBase);
        }


private async System.Threading.Tasks.Task PlayReplaySelectionSmoothAsync(
    System.Collections.Generic.List<ReplayPro.Core.FramePacket> selection,
    int token,
    string stateText)
{
    if (selection == null || selection.Count == 0)
        return;

    int targetDelayMs = GetReplayFrameDelayMs();
    var sw = System.Diagnostics.Stopwatch.StartNew();
    long nextDue = 0;

    for (int i = 0; i < selection.Count; i++)
    {
        if (token != playbackToken)
            break;

        var framePacket = selection[i];
        if (framePacket?.Frame == null)
            continue;

        BitmapImage? img = null;
        try
        {
            if (framePacket.Frame.Empty())
                continue;

            using var localFrame = framePacket.Frame.Clone();
            if (localFrame.Empty() || localFrame.Width <= 0 || localFrame.Height <= 0)
                continue;

            img = ConvertMat(localFrame);
        }
        catch
        {
            continue;
        }

        int index = i;
        var localImg = img;
        await Dispatcher.BeginInvoke(new Action(() =>
        {
            if (token != playbackToken || localImg == null)
                return;

            ProgramCameraPreview.Source = localImg;
            pgmWindow?.SetFrame(localImg);
            ProgramFrameCounterText.Text = "Frame: " + index;
            ProgramTimecodeText.Text = "TC: " + FrameToTimecode(index);
            ReplayPlayheadText.Text = "Playhead: CLIP " + FrameToTimecode(index);
            ProgramStateText.Text = stateText;
        }), System.Windows.Threading.DispatcherPriority.Render);

        nextDue += targetDelayMs;
        int wait = (int)(nextDue - sw.ElapsedMilliseconds);
        if (wait > 0)
            await System.Threading.Tasks.Task.Delay(wait);
    }
}

private async void PlayLastSecondsReplay(int seconds)
{
    if (!TryBeginReplayQueue())
    {
        SetStatus("Status: Replay busy");
        return;
    }

    try
    {
        SetStatus("Status: Preparing replay from buffer...");
        var selection = await System.Threading.Tasks.Task.Run(() => BuildReplaySelectionFast(seconds));
        if (selection.Count == 0)
        {
            SetStatus("Status: No replay frames available");
            return;
        }

        clipCounter++;
        string name = "Last " + seconds + "s Replay " + clipCounter.ToString("000");
        var clip = new ReplayPro.Core.ClipItem
        {
            Name = name,
            CreatedAt = DateTime.Now,
            CameraSource = coordinator.ProgramCamera,
            Frames = selection
        };

        await PlayReplayRequestAsync(
            selection,
            "REPLAY",
            "Status: Replay finished. Press TAKE LIVE");

        SetStatus("Status: Replay finished, saving clip...");
        QueueReplayClipSave(clip);
    }
    finally
    {
        EndReplayQueue();
    }
}

private void Last5Replay_Click(object sender, RoutedEventArgs e)
{
    PlayLastSecondsReplay(5);
}

private void Last8Replay_Click(object sender, RoutedEventArgs e)
{
    PlayLastSecondsReplay(8);
}

private void Last10Replay_Click(object sender, RoutedEventArgs e)
{
    PlayLastSecondsReplay(10);
}

        private void OpenPgmButton_Click(object sender, RoutedEventArgs e)
        {
            OpenProgramOutputOnSecondScreen();
        }

        private void VirtualJogLeftButton_Click(object sender, RoutedEventArgs e)
        {
            virtualShuttleTimer.Stop();
            abLoopTimer.Stop();
            VirtualShuttleSlider.Value = 0;
            JogByFrames(-1);
        }

        private void VirtualJogRightButton_Click(object sender, RoutedEventArgs e)
        {
            virtualShuttleTimer.Stop();
            abLoopTimer.Stop();
            VirtualShuttleSlider.Value = 0;
            JogByFrames(1);
        }

        private void VirtualShuttleSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (!IsLoaded)
                return;

            virtualShuttleSpeed = (int)e.NewValue;
            virtualShuttleAccumulator = 0;
            VirtualShuttleValueText.Text = virtualShuttleSpeed.ToString() + "x";

            if (virtualShuttleSpeed == 0)
            {
                virtualShuttleTimer.Stop();
            abLoopTimer.Stop();
                SetStatus("Status: Virtual shuttle stopped");
            }
            else
            {
                if (!replaySessionActive)
                    BeginReplaySession();
                virtualShuttleTimer.Start();
                SetStatus("Status: Virtual shuttle " + virtualShuttleSpeed.ToString() + "x");
            }
        }

        private void VirtualShuttleStopButton_Click(object sender, RoutedEventArgs e)
        {
            virtualShuttleTimer.Stop();
            abLoopTimer.Stop();
            VirtualShuttleSlider.Value = 0;
            VirtualShuttleValueText.Text = "0x";
            SetStatus("Status: Virtual shuttle stopped");
        }

        private void Speed50_Click(object sender, RoutedEventArgs e)
        {
            replaySpeed = 0.5;
            UpdateSpeedButtons();
        }

        private void Speed100_Click(object sender, RoutedEventArgs e)
        {
            replaySpeed = 1.0;
            UpdateSpeedButtons();
        }

        private void MarkIn_Click(object sender, RoutedEventArgs e)
        {
            if (currentMode == OutputMode.Live)
            {
                currentFrameIndex = Math.Max(0, GetProgramBufferSnapshot().Count - 1);
                markInFrame = currentFrameIndex;
                markInDisplayTimecode = CurrentClockTimecode();
            }
            else
            {
                if (!replaySessionActive)
                    BeginReplaySession();
                markInFrame = playheadFrameIndex;
                currentFrameIndex = playheadFrameIndex;
                markInDisplayTimecode = FrameToTimecode(markInFrame);
            }

            UpdateInOutTexts();
            SetStatus("Status: Mark IN set at " + markInDisplayTimecode);
        }

        private void MarkOut_Click(object sender, RoutedEventArgs e)
        {
            if (currentMode == OutputMode.Live)
            {
                currentFrameIndex = Math.Max(0, GetProgramBufferSnapshot().Count - 1);
                markOutFrame = currentFrameIndex;
                markOutDisplayTimecode = CurrentClockTimecode();
            }
            else
            {
                if (!replaySessionActive)
                    BeginReplaySession();
                markOutFrame = playheadFrameIndex;
                currentFrameIndex = playheadFrameIndex;
                markOutDisplayTimecode = FrameToTimecode(markOutFrame);
            }

            UpdateInOutTexts();
            SetStatus("Status: Mark OUT set at " + markOutDisplayTimecode);
        }

        
private async System.Threading.Tasks.Task PlaySelectedClipPlaylistAsync(
    System.Collections.Generic.List<ReplayPro.Core.ClipItem> playlist,
    int token,
    int selectedToken)
{
    foreach (var clip in playlist)
    {
        if (token != playbackToken || selectedToken != selectedClipPlaybackToken)
            break;

        string stateText = playlist.Count > 1 ? "PLAYLIST" : "CLIP";

        if (clip.IsImportedMedia && !string.IsNullOrWhiteSpace(clip.ImportedFile))
        {
            SetStatus("Status: Imported clip playback from playlist is not enabled in this version");
            continue;
        }

        if (clip.Frames == null || clip.Frames.Count == 0)
            continue;

        var selection = clip.Frames
            .Where(fp => fp?.Frame != null && !fp.Frame.Empty())
            .ToList();

        if (selection.Count == 0)
            continue;

        await PlayReplaySelectionSmoothAsync(selection, token, stateText);
    }
}

private async void ReplaySelected_Click(object sender, RoutedEventArgs e)
{
    if (!TryBeginReplayQueue())
    {
        SetStatus("Status: Replay busy");
        return;
    }

    var playlist = GetPlaylistClipsForPlayback();
    if (playlist.Count == 0)
    {
        EndReplayQueue();
        SetStatus("Status: No clip selected");
        return;
    }

    playbackToken++;
    int token = playbackToken;
    selectedClipPlaybackToken++;
    int selectedToken = selectedClipPlaybackToken;
    isSelectedClipPlaying = true;
    currentMode = OutputMode.Replay;
    isLoopPlaying = false;
    abLoopTimer.Stop();

    ProgramStateText.Text = playlist.Count > 1 ? "PLAYLIST" : "CLIP";
    ProgramMarkText.Text = playlist.Count > 1 ? "PLAYLIST" : "CLIP";
    SetStatus("Status: Playing selected clip playlist");

    try
    {
        await PlaySelectedClipPlaylistAsync(playlist, token, selectedToken);
    }
    finally
    {
        EndReplayQueue();
        if (selectedToken == selectedClipPlaybackToken)
            HoldOnCurrentProgramFrame("HOLD", "Status: Playlist finished. Press TAKE LIVE");
    }
}



        private void SaveMarkedClip_Click(object sender, RoutedEventArgs e)
        {
            if (!replaySessionActive)
                BeginReplaySession();

            SaveCurrentReplaySelection();
        }

        private void TakeLive_Click(object sender, RoutedEventArgs e)
        {
            playbackToken++;
            selectedClipPlaybackToken++;
            isSelectedClipPlaying = false;
            ResetReplayState();
            currentMode = OutputMode.Live;
            ProgramStateText.Text = "LIVE";
            ProgramMarkText.Text = "LIVE";
            isLoopPlaying = false;
            abLoopTimer.Stop();
            isTimelineDragging = false;
            ReplayTimelineTrackBorder.ReleaseMouseCapture();
            SetStatus("Status: Took PGM back to live");
            UpdateReplayTimelineUi();
        }

        private void SwitchCamera_Click(object sender, RoutedEventArgs e)
        {
            playbackToken++;
            ResetReplayState();
            coordinator.SwitchCamera();
            currentMode = OutputMode.Live;
            selectedClipPlaybackToken++;
            isSelectedClipPlaying = false;
            isTimelineDragging = false;
            ReplayTimelineTrackBorder.ReleaseMouseCapture();
            SetStatus("Status: Program camera " + coordinator.ProgramCamera);
            UpdateReplayTimelineUi();
        }


private async void AutoReplay_Click(object sender, RoutedEventArgs e)
{
    if (!TryBeginAutoReplay())
    {
        SetStatus("Status: Auto replay busy");
        return;
    }

    if (!TryBeginReplayQueue())
    {
        SetStatus("Status: Replay busy");
        EndAutoReplay();
        return;
    }

    try
    {
        if (diskRecordController != null && diskRecordController.IsRecording)
        {
            SetStatus("Status: Auto replay skipped while SSD recording is active");
            return;
        }

        if (isSelectedClipPlaying || isLoopPlaying || isTimelineDragging)
        {
            SetStatus("Status: Auto replay skipped while playback is active");
            return;
        }

        SetStatus("Status: Preparing auto replay from buffer...");
        var selection = await System.Threading.Tasks.Task.Run(() => BuildReplaySelectionFast(settings.AutoReplaySeconds));
        if (selection.Count == 0)
        {
            SetStatus("Status: No auto replay frames available");
            return;
        }

        clipCounter++;
        string name = "Auto Replay " + clipCounter.ToString("000");
        var autoClip = new ReplayPro.Core.ClipItem
        {
            Name = name,
            CreatedAt = DateTime.Now,
            CameraSource = coordinator.ProgramCamera,
            Frames = selection
        };

        await PlayReplayRequestAsync(
            selection,
            "AUTO",
            "Status: Auto replay finished. Press TAKE LIVE");

        SetStatus("Status: Auto replay finished, saving clip...");
        QueueReplayClipSave(autoClip);
    }
    finally
    {
        EndReplayQueue();
        EndAutoReplay();
    }
}


        private List<ReplayPro.Core.FramePacket> GetProgramBufferSnapshot()
        {
            return coordinator.ProgramCamera == 1 ? buffer1.Snapshot() : buffer2.Snapshot();
        }

        private void ApplyCameras_Click(object sender, RoutedEventArgs e)
        {
            var c1 = Camera1ComboBox.SelectedItem as ReplayPro.Engine.CameraDeviceInfo;
            var c2 = Camera2ComboBox.SelectedItem as ReplayPro.Engine.CameraDeviceInfo;
            if (c1 == null || c2 == null)
                return;

            settings.Camera1Index = c1.Index;
            settings.Camera2Index = c2.Index;
            CreateCameraWorkers(settings.Camera1Index, settings.Camera2Index, settings.Camera1Mode, settings.Camera2Mode);
            ResetReplayState();
            currentMode = OutputMode.Live;
            SetStatus("Status: Cameras updated");
        }

        private void ImportVideo_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Filter = "Video Files|*.mp4;*.mov;*.avi;*.mkv;*.mxf"
            };

            if (dialog.ShowDialog() != true)
                return;

            string path = dialog.FileName;
            if (!File.Exists(path))
                return;

            clipLibrary.AddClip(new ReplayPro.Core.ClipItem
            {
                Name = Path.GetFileNameWithoutExtension(path),
                CreatedAt = DateTime.Now,
                CameraSource = 0,
                IsImportedMedia = true,
                ImportedFile = path,
                DurationSeconds = mediaPlayback.GetDurationSeconds(path)
            });

            RefreshClipList();
            ClipListBox.SelectedIndex = ClipListBox.Items.Count - 1;
            SetStatus("Status: Imported " + Path.GetFileName(path));
        }

        private void ExportSelected_Click(object sender, RoutedEventArgs e)
        {
            var clip = clipLibrary.GetClip(ClipListBox.SelectedIndex);
            if (clip == null || clip.Frames == null || clip.Frames.Count == 0)
            {
                SetStatus("Status: No exportable clip selected");
                return;
            }

            string? file = exportService.ExportReplay(clip.Frames, settings.ExportFolder, settings.FPS, clip.Name);
            SetStatus(file != null ? "Status: Exported " + clip.Name : "Status: Export failed");
        }

        private void DeleteSelected_Click(object sender, RoutedEventArgs e)
        {
            if (ClipListBox.SelectedIndex < 0)
                return;

            clipLibrary.RemoveClip(ClipListBox.SelectedIndex);
            RefreshClipList();
            SelectedClipNoteTextBox.Text = "";
            SetStatus("Status: Clip deleted");
        }

        private void RefreshClipList()
{
    int previousIndex = GetSelectedClipIndex();

    ClipListBox.Items.Clear();

    int i = 0;
    foreach (var clip in clipLibrary.GetClips())
    {
        var check = new System.Windows.Controls.CheckBox
        {
            Content = clip.ToString(),
            Tag = i,
            IsChecked = playlistSelection.Contains(i),
            Foreground = System.Windows.Media.Brushes.White,
            Margin = new Thickness(2)
        };
        check.Checked += ClipPlaylistCheckBox_Checked;
        check.Unchecked += ClipPlaylistCheckBox_Unchecked;
        ClipListBox.Items.Add(check);
        i++;
    }

    if (previousIndex >= 0 && previousIndex < ClipListBox.Items.Count)
        ClipListBox.SelectedIndex = previousIndex;

    ClipListBox.Items.Refresh();
    DebugText.Text = "Debug: Clips in library = " + ClipListBox.Items.Count + " | Playlist selected = " + playlistSelection.Count + " | Shuttle connected: " + shuttleInputService.IsConnected;
}

        private void ClipListBox_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
{
    int idx = GetSelectedClipIndex();
    var clip = clipLibrary.GetClip(idx);
    SelectedClipNoteTextBox.Text = clip?.Notes ?? "";
}

        private void SelectedClipNoteTextBox_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
        {
            if (e.Key != System.Windows.Input.Key.Enter || 
                (System.Windows.Input.Keyboard.Modifiers & System.Windows.Input.ModifierKeys.Shift) == System.Windows.Input.ModifierKeys.Shift)
                return;

            int noteIndex = GetSelectedClipIndex();
            if (noteIndex < 0)
                return;

            var clip = clipLibrary.GetClip(noteIndex);
            if (clip == null)
                return;

            clip.Notes = SelectedClipNoteTextBox.Text ?? "";
            int selectedIndex = noteIndex;
            RefreshClipList();
            if (selectedIndex >= 0 && selectedIndex < ClipListBox.Items.Count)
                ClipListBox.SelectedIndex = selectedIndex;

            SetStatus("Status: Note saved for " + clip.Name);
            e.Handled = true;
        }
    

private void InstantReplayHotkeys_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
{
    if (e.Key == System.Windows.Input.Key.D1)
    {
        Last5Replay_Click(this, new RoutedEventArgs());
        e.Handled = true;
    }
    else if (e.Key == System.Windows.Input.Key.D2)
    {
        Last8Replay_Click(this, new RoutedEventArgs());
        e.Handled = true;
    }
    else if (e.Key == System.Windows.Input.Key.D3)
    {
        Last10Replay_Click(this, new RoutedEventArgs());
        e.Handled = true;
    }
}
}
}
