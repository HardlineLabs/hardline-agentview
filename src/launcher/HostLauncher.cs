using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Windows.Forms;

// The managed entry point opens the installed Host without extracting a portable bundle.
internal static class HostLauncher
{
    [DataContract]
    private sealed class Installation
    {
        [DataMember(Name = "executable")]
        public string Executable;
    }

    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            Installation installation;
            // Windows PowerShell can write a UTF-8 BOM; normalize it before JSON parsing.
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(File.ReadAllText(Path.Combine(root, "current.json")))))
                installation = (Installation)new DataContractJsonSerializer(typeof(Installation)).ReadObject(stream);
            if (installation == null || String.IsNullOrWhiteSpace(installation.Executable))
                throw new InvalidDataException("The installed Host version is missing.");
            string target = Path.GetFullPath(Path.Combine(root, installation.Executable));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
                String.Equals(target, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(target))
                throw new InvalidDataException("The installed Host executable could not be found.");
            Process.Start(new ProcessStartInfo(target)
            {
                Arguments = Array.IndexOf(args, "--hidden") >= 0 ? "--role=host --hidden" : "--role=host",
                WorkingDirectory = Path.GetDirectoryName(target),
                UseShellExecute = false
            });
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            MessageBox.Show(error.Message + "\n\nRun the AgentView managed installer again to repair this folder.",
                "AgentView could not open", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
