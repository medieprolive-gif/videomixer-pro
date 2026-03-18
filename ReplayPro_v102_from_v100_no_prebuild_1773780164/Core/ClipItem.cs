using System.Collections.Generic;

namespace ReplayPro.Core
{
    public class ClipItem
    {
        public string Name { get; set; }
        public System.DateTime CreatedAt { get; set; }
        public int CameraSource { get; set; }
        public List<FramePacket> Frames { get; set; }
        public bool IsImportedMedia { get; set; }
        public string ImportedFile { get; set; }
        public double DurationSeconds { get; set; }
        public string Notes { get; set; }

        public override string ToString()
        {
            string notePart = string.IsNullOrWhiteSpace(Notes) ? "" : " | " + Notes;

            if (IsImportedMedia)
                return Name + " | MEDIA | " + CreatedAt.ToString("HH:mm:ss") + notePart;

            return Name + " | Cam " + CameraSource + " | " + CreatedAt.ToString("HH:mm:ss") + notePart;
        }
    }
}
