using System.Collections.Generic;
using ReplayPro.Core;

namespace ReplayPro.Engine
{
    public class FrameRingBuffer
    {
        private readonly FramePacket[] buffer;
        private int index = 0;
        private readonly object sync = new object();

        public FrameRingBuffer(int size)
        {
            buffer = new FramePacket[size];
        }

        public void Add(FramePacket frame)
        {
            lock (sync)
            {
                if (buffer[index] != null)
                    buffer[index].Dispose();

                buffer[index] = frame;
                index++;
                if (index >= buffer.Length)
                    index = 0;
            }
        }

        public List<FramePacket> Snapshot()
        {
            lock (sync)
            {
                var result = new List<FramePacket>();

                for (int i = 0; i < buffer.Length; i++)
                {
                    int pos = (index + i) % buffer.Length;
                    if (buffer[pos] != null)
                        result.Add(buffer[pos].Clone());
                }

                return result;
            }
        }

        public List<FramePacket> GetLatestRangeReferences(int count)
        {
            lock (sync)
            {
                var available = new List<FramePacket>();
                for (int i = 0; i < buffer.Length; i++)
                {
                    int pos = (index + i) % buffer.Length;
                    if (buffer[pos] != null)
                        available.Add(buffer[pos]);
                }

                if (available.Count == 0)
                    return new List<FramePacket>();

                if (count <= 0 || count >= available.Count)
                    return new List<FramePacket>(available);

                int start = available.Count - count;
                return available.GetRange(start, count);
            }
        }
    }
}
