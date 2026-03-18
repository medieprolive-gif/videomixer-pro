using System.Collections.Generic;
using ReplayPro.Core;

namespace ReplayPro.Engine
{
    public class ClipModel
    {
        public List<FramePacket> Frames { get; set; } = new List<FramePacket>();

        public int StartFrame { get; set; }

        public int EndFrame { get; set; }

        public string Name { get; set; } = "";
    }
}
