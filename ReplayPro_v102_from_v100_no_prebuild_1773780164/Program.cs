using System;
using System.Windows;

namespace ReplayPro
{
    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            var app = new App();
            var mainWindow = new MainWindow();
            app.Run(mainWindow);
        }
    }
}
