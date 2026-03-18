using System;
using OpenCvSharp;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace ReplayPro
{
    /// <summary>
    /// v70 broadcast engine:
    /// stable delegated GPU path with watchdog-friendly present behavior.
    /// Still compile-safe and conservative.
    /// </summary>
    public sealed class GpuShaderRenderer : IDisposable
    {
        private readonly ID3D11Device? device;
        private readonly ID3D11DeviceContext? context;
        private readonly IDXGISwapChain? swapChain;
        private readonly ID3D11RenderTargetView? renderTarget;
        private ID3D11Texture2D? stagingTexture;
        private readonly object sync = new object();

        public GpuShaderRenderer(
            ID3D11Device? device,
            ID3D11DeviceContext? context,
            IDXGISwapChain? swapChain,
            ID3D11RenderTargetView? renderTarget)
        {
            this.device = device;
            this.context = context;
            this.swapChain = swapChain;
            this.renderTarget = renderTarget;
        }

        public bool IsReady =>
            device != null &&
            context != null &&
            swapChain != null &&
            renderTarget != null;

        public Mat PrepareFrameForShader(Mat source)
        {
            if (source == null || source.Empty())
                return new Mat();

            Mat progressive = new Mat();

            if (source.Height >= 1000)
            {
                using Mat half = new Mat();
                using Mat softened = new Mat();

                Cv2.Resize(source, half, new OpenCvSharp.Size(source.Width, source.Height / 2), 0, 0, InterpolationFlags.Area);
                Cv2.GaussianBlur(half, softened, new OpenCvSharp.Size(0, 0), 0.20);
                Cv2.Resize(softened, progressive, new OpenCvSharp.Size(1280, 720), 0, 0, InterpolationFlags.Lanczos4);
            }
            else
            {
                Cv2.Resize(source, progressive, new OpenCvSharp.Size(1280, 720), 0, 0, InterpolationFlags.Lanczos4);
            }

            using Mat denoised = new Mat();
            using Mat balanced = new Mat();

            Cv2.GaussianBlur(progressive, denoised, new OpenCvSharp.Size(0, 0), 0.24);
            Cv2.AddWeighted(progressive, 1.02, denoised, -0.02, 0, balanced);

            Mat bgra = new Mat();
            if (balanced.Channels() == 4)
                balanced.CopyTo(bgra);
            else if (balanced.Channels() == 3)
                Cv2.CvtColor(balanced, bgra, ColorConversionCodes.BGR2BGRA);
            else
                Cv2.CvtColor(balanced, bgra, ColorConversionCodes.GRAY2BGRA);

            progressive.Dispose();
            return bgra;
        }

        public bool TryRender(Mat source)
        {
            if (!IsReady || source == null || source.Empty())
                return false;

            lock (sync)
            {
                try
                {
                    using Mat owned = source.Clone();
                    using Mat prepared = PrepareFrameForShader(owned);

                    if (prepared.Empty())
                        return false;

                    var textureDesc = new Texture2DDescription
                    {
                        Width = (uint)prepared.Width,
                        Height = (uint)prepared.Height,
                        MipLevels = 1,
                        ArraySize = 1,
                        Format = Format.B8G8R8A8_UNorm,
                        SampleDescription = new SampleDescription(1, 0),
                        Usage = ResourceUsage.Default,
                        BindFlags = BindFlags.ShaderResource,
                        CPUAccessFlags = CpuAccessFlags.None
                    };

                    var subresource = new SubresourceData(prepared.Data, (uint)prepared.Step(), 0);

                    stagingTexture?.Dispose();
                    stagingTexture = device!.CreateTexture2D(textureDesc, new[] { subresource });

                    using var backBuffer = swapChain!.GetBuffer<ID3D11Texture2D>(0);

                    context!.OMSetRenderTargets(renderTarget);
                    context.ClearRenderTargetView(renderTarget!, new Vortice.Mathematics.Color4(0, 0, 0, 1));
                    context.CopyResource(backBuffer, stagingTexture);
                    swapChain.Present(1, PresentFlags.None);
                    return true;
                }
                catch
                {
                    return false;
                }
            }
        }

        public void Clear()
        {
            if (!IsReady)
                return;

            lock (sync)
            {
                context!.OMSetRenderTargets(renderTarget);
                context.ClearRenderTargetView(renderTarget!, new Vortice.Mathematics.Color4(0, 0, 0, 1));
                swapChain!.Present(1, PresentFlags.None);
            }
        }

        public void Dispose()
        {
            stagingTexture?.Dispose();
            stagingTexture = null;
        }
    }
}
