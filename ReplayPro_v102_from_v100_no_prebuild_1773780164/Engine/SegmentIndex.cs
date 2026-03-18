
using System;
using System.IO;
using System.Linq;

namespace ReplayPro.Engine
{
    public class SegmentIndex
    {
        private readonly string rootFolder;

        public SegmentIndex(string rootFolder)
        {
            this.rootFolder = rootFolder;
            Directory.CreateDirectory(rootFolder);
        }

        public void TrimOldSegments(string cameraName, int keepMinutes)
        {
            string folder = Path.Combine(rootFolder, cameraName);
            if (!Directory.Exists(folder))
                return;

            DateTime cutoff = DateTime.UtcNow.AddMinutes(-keepMinutes);

            foreach (var file in Directory.GetFiles(folder, "*.avi").OrderBy(x => x))
            {
                try
                {
                    var info = new FileInfo(file);
                    if (info.CreationTimeUtc < cutoff)
                        info.Delete();
                }
                catch
                {
                }
            }
        }
    }
}
