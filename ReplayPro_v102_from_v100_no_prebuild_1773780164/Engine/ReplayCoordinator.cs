namespace ReplayPro.Engine
{
    public class ReplayCoordinator
    {
        public int ProgramCamera { get; private set; } = 1;

        public void SwitchCamera()
        {
            ProgramCamera = ProgramCamera == 1 ? 2 : 1;
        }
    }
}
