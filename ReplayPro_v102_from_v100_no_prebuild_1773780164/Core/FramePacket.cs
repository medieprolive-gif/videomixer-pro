using OpenCvSharp;

namespace ReplayPro.Core
{
    public class FramePacket
    {
        public Mat Frame { get; set; }
        public System.DateTime TimestampUtc { get; set; }
        public int CameraId { get; set; }

        public FramePacket Clone()
        {
            return new FramePacket
            {
                Frame = Frame.Clone(),
                TimestampUtc = TimestampUtc,
                CameraId = CameraId
            };
        }

        public void Dispose()
        {
            Frame?.Dispose();
        }
    }
}
