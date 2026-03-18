using OpenCvSharp;
using System;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using static Vortice.Direct3D11.D3D11;

namespace ReplayPro
{
    public class GpuProgramOutputWindow : System.Windows.Window, IProgramOutputSink
    {
        private ID3D11Device? device;
        private ID3D11DeviceContext? context;
        private IDXGISwapChain? swapChain;
        private ID3D11RenderTargetView? renderTarget;
        private GpuShaderRenderer? shaderRenderer;

        private readonly object frameLock = new object();
        private Mat? latestFrame;
        private DateTime lastSuccessfulPresentUtc = DateTime.MinValue;
        private DispatcherTimer? watchdogTimer;

        public GpuProgramOutputWindow()
        {
            Title = "ReplayPro GPU Output";
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            Topmost = true;
            Background = System.Windows.Media.Brushes.Black;

            Loaded += InitDirectX;
            Closed += OnClosed;

            watchdogTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(250)
            };
            watchdogTimer.Tick += WatchdogTimer_Tick;
        }

        private void InitDirectX(object? sender, RoutedEventArgs e)
        {
            var hwnd = new WindowInteropHelper(this).Handle;

            var desc = new SwapChainDescription()
            {
                BufferCount = 2,
                BufferDescription = new ModeDescription(1280, 720, new Rational(50, 1), Format.B8G8R8A8_UNorm),
                BufferUsage = Usage.RenderTargetOutput,
                OutputWindow = hwnd,
                SampleDescription = new SampleDescription(1, 0),
                Windowed = true,
                SwapEffect = SwapEffect.Discard
            };

            var featureLevels = new[]
            {
                FeatureLevel.Level_11_0,
                FeatureLevel.Level_10_1
            };

            D3D11CreateDeviceAndSwapChain(
                null,
                DriverType.Hardware,
                DeviceCreationFlags.BgraSupport,
                featureLevels,
                desc,
                out swapChain,
                out device,
                out FeatureLevel? featureLevel,
                out context
            );

            using var backBuffer = swapChain.GetBuffer<ID3D11Texture2D>(0);
            renderTarget = device.CreateRenderTargetView(backBuffer);

            shaderRenderer = new GpuShaderRenderer(device, context, swapChain, renderTarget);
            watchdogTimer?.Start();

            Clear();
        }

        private void WatchdogTimer_Tick(object? sender, EventArgs e)
        {
            try
            {
                if (shaderRenderer == null)
                    return;

                if (lastSuccessfulPresentUtc == DateTime.MinValue)
                    return;

                if ((DateTime.UtcNow - lastSuccessfulPresentUtc).TotalMilliseconds < 500)
                    return;

                Mat? replayFrame = null;
                lock (frameLock)
                {
                    if (latestFrame != null && !latestFrame.Empty())
                        replayFrame = latestFrame.Clone();
                }

                if (replayFrame == null)
                    return;

                using (replayFrame)
                {
                    if (shaderRenderer.TryRender(replayFrame))
                        lastSuccessfulPresentUtc = DateTime.UtcNow;
                }
            }
            catch
            {
            }
        }

        private void OnClosed(object? sender, EventArgs e)
        {
            watchdogTimer?.Stop();

            lock (frameLock)
            {
                latestFrame?.Dispose();
                latestFrame = null;
            }

            shaderRenderer?.Dispose();
            renderTarget?.Dispose();
            swapChain?.Dispose();
            context?.Dispose();
            device?.Dispose();

            shaderRenderer = null;
            renderTarget = null;
            swapChain = null;
            context = null;
            device = null;
        }

        public void SetFrame(ImageSource imageSource)
        {
            // This GPU sink prefers Mat-based rendering.
            // Keep a safe no-op/clear fallback for interface compatibility.
            Clear();
        }

        public void SetFrameMat(Mat frame)
        {
            if (frame == null || frame.Empty())
                return;

            try
            {
                using Mat safeFrame = frame.Clone();

                lock (frameLock)
                {
                    latestFrame?.Dispose();
                    latestFrame = safeFrame.Clone();
                }

                if (shaderRenderer != null && shaderRenderer.TryRender(safeFrame))
                {
                    lastSuccessfulPresentUtc = DateTime.UtcNow;
                    return;
                }
            }
            catch
            {
            }

            Clear();
        }

        public new void Show()
        {
            base.Show();
        }

        public void Clear()
        {
            try
            {
                if (shaderRenderer != null)
                {
                    shaderRenderer.Clear();
                    lastSuccessfulPresentUtc = DateTime.UtcNow;
                    return;
                }

                if (context == null || swapChain == null || renderTarget == null)
                    return;

                context.OMSetRenderTargets(renderTarget);
                context.ClearRenderTargetView(renderTarget, new Vortice.Mathematics.Color4(0, 0, 0, 1));
                swapChain.Present(1, PresentFlags.None);
                lastSuccessfulPresentUtc = DateTime.UtcNow;
            }
            catch
            {
            }
        }
    }
}
