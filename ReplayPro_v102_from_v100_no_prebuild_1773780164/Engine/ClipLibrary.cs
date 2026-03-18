using System.Collections.Generic;
using ReplayPro.Core;

namespace ReplayPro.Engine
{
    public class ClipLibrary
    {
        private readonly List<ClipItem> clips = new List<ClipItem>();

        public void AddClip(ClipItem clip) => clips.Add(clip);

        public List<ClipItem> GetClips() => clips;

        public ClipItem GetClip(int index)
        {
            if (index < 0 || index >= clips.Count)
                return null;

            return clips[index];
        }

        public void RemoveClip(int index)
        {
            if (index >= 0 && index < clips.Count)
                clips.RemoveAt(index);
        }

        public int Count() => clips.Count;
    }
}
