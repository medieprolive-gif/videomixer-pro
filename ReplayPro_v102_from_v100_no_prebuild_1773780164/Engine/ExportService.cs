using System.Collections.Generic;
using System.IO;
using OpenCvSharp;
using ReplayPro.Core;

namespace ReplayPro.Engine
{
    public class ExportService
    {
        public string ExportReplay(List<FramePacket> frames, string folderPath, int fps, string fileNamePrefix)
        {
            if (frames == null || frames.Count == 0)
                return null;

            if (!Directory.Exists(folderPath))
                Directory.CreateDirectory(folderPath);

            string safePrefix = string.IsNullOrWhiteSpace(fileNamePrefix) ? "Replay" : fileNamePrefix;
            safePrefix = safePrefix.Replace(":", "_");
            safePrefix = safePrefix.Replace("/", "_");
            safePrefix = safePrefix.Replace("\\", "_");

            string filePath = Path.Combine(
                folderPath,
                safePrefix + "_" + System.DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".avi"
            );

            OpenCvSharp.Size size = new OpenCvSharp.Size(frames[0].Frame.Width, frames[0].Frame.Height);

            using (var writer = new VideoWriter(filePath, FourCC.MJPG, fps, size))
            {
                foreach (var frame in frames)
                    writer.Write(frame.Frame);
            }

            return filePath;
        }
    }
}
