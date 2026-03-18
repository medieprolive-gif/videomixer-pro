using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using OpenCvSharp;
using ReplayPro.Core;

namespace ReplayPro.Engine
{
    public class ReplayPlayer
    {
        public async Task Play(List<FramePacket> frames, Action<Mat, int> render, double speed, Func<bool> shouldStop = null)
        {
            if (frames == null || frames.Count == 0)
                return;

            if (speed <= 0)
                speed = 1.0;

            int delay = System.Math.Max(1, (int)(33.0 / speed));

            for (int i = 0; i < frames.Count; i++)
            {
                if (shouldStop != null && shouldStop())
                    break;

                render(frames[i].Frame, i);
                await Task.Delay(delay);
            }
        }
    }
}
