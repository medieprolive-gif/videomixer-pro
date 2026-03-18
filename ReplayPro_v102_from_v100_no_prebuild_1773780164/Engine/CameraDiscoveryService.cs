using System.Collections.Generic;
using DirectShowLib;

namespace ReplayPro.Engine
{
    public class CameraDiscoveryService
    {
        public List<CameraDeviceInfo> GetVideoDevices()
        {
            var result = new List<CameraDeviceInfo>();
            var devices = DsDevice.GetDevicesOfCat(FilterCategory.VideoInputDevice);

            for (int i = 0; i < devices.Length; i++)
            {
                result.Add(new CameraDeviceInfo
                {
                    Name = devices[i].Name,
                    Index = i
                });
            }

            return result;
        }
    }
}
