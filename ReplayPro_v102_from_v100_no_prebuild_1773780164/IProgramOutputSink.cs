using OpenCvSharp;
using System.Windows.Media;

namespace ReplayPro
{
    public interface IProgramOutputSink
    {
        void Show();
        void Clear();
        void SetFrame(ImageSource imageSource);
        void SetFrameMat(Mat frame);
        void Close();
    }
}
