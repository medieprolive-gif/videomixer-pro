using System.Windows.Media;
using System.Windows.Media.Imaging;
using OpenCvSharp;

namespace ReplayPro
{
    public partial class ProgramOutputWindow : System.Windows.Window, IProgramOutputSink
    {
        private WriteableBitmap? writeableBitmap;
        private readonly object frameLock = new object();

        public ProgramOutputWindow()
        {
            InitializeComponent();
        }

        public void SetFrame(ImageSource imageSource)
        {
            ProgramOutputImage.Source = imageSource;
        }

        public void SetFrameMat(Mat mat)
        {
            if (mat == null || mat.Empty())
                return;

            Mat? converted = null;
            try
            {
                if (mat.Channels() == 3)
                {
                    converted = new Mat();
                    Cv2.CvtColor(mat, converted, ColorConversionCodes.BGR2BGRA);
                }
                else if (mat.Channels() == 4)
                {
                    converted = mat.Clone();
                }
                else if (mat.Channels() == 1)
                {
                    converted = new Mat();
                    Cv2.CvtColor(mat, converted, ColorConversionCodes.GRAY2BGRA);
                }
                else
                {
                    return;
                }

                int width = converted.Width;
                int height = converted.Height;
                int stride = width * 4;

                lock (frameLock)
                {
                    if (writeableBitmap == null || writeableBitmap.PixelWidth != width || writeableBitmap.PixelHeight != height)
                    {
                        writeableBitmap = new WriteableBitmap(width, height, 96, 96, PixelFormats.Bgra32, null);
                        ProgramOutputImage.Source = writeableBitmap;
                    }

                    writeableBitmap.WritePixels(new System.Windows.Int32Rect(0, 0, width, height), converted.Data, stride * height, stride);
                }
            }
            catch
            {
            }
            finally
            {
                converted?.Dispose();
            }
        }

        public void Clear()
        {
            ProgramOutputImage.Source = null;
            writeableBitmap = null;
        }
    }
}
