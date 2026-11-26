// Native launchers of the per-user installation, compiled on the installing
// machine by the .NET Framework compiler that ships with Windows (as Scope does).
//
//   <root>\Irudd Workshop.exe   starts the current build's desktop app
//       --player                opens the current build's offline GLB player
//       --wait-pid <pid> ...    waits for an updating app to exit, then starts
//       --create-shortcut <lnk> <description> [arguments]
//   <root>\bin\irudd.exe        (IRUDD_CLI) runs the current build's CLI, or
//       host ... / mcp ...      its headless host or stdio MCP server,
//                               with the build's own executable as Node
//
// Each launch resolves the current build from installation.json first, so a
// running app or MCP session keeps its build while an update or rollback
// switches it. The activator replaces that file in one rename, so a launch
// sees either the old or the new build, never a half-done switch. A preview
// installation without the file falls back to the `current` junction.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;

#if IRUDD_CLI
[assembly: AssemblyProduct("Irudd Workshop launcher v1 (CLI)")]
#else
[assembly: AssemblyProduct("Irudd Workshop launcher v1 (desktop)")]
#endif

internal static class IruddLauncher
{
    private const string AppId = "alundgren.irudd-game-tools";
    private const string AppFolder = "Irudd Workshop";
    private const string AppExecutable = "Irudd Workshop.exe";

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string self = Assembly.GetExecutingAssembly().Location;
            string root = Path.GetDirectoryName(self);
#if IRUDD_CLI
            root = Path.GetDirectoryName(root);
#else
            if (args.Length >= 3 && args[0] == "--create-shortcut")
            {
                string[] rest = new string[args.Length - 3];
                Array.Copy(args, 3, rest, 0, rest.Length);
                CreateShortcut(self, args[1], args[2], Join(rest));
                return 0;
            }
            int first = 0;
            if (args.Length >= 2 && args[0] == "--wait-pid")
            {
                WaitFor(int.Parse(args[1]));
                first = 2;
            }
            string[] passed = new string[args.Length - first];
            Array.Copy(args, first, passed, 0, passed.Length);
            args = passed;
#endif
            string build = ResolveBuild(root);
            string app = Path.Combine(build, AppFolder);
            string runtime = Path.Combine(app, AppExecutable);
            if (!File.Exists(runtime)) throw new IOException("The active build is missing. Run install.ps1 again.");
            string resources = Path.Combine(app, "resources", "app");
#if !IRUDD_CLI
            if (args.Length == 1 && args[0] == "--player")
            {
                ProcessStartInfo page = new ProcessStartInfo(Path.Combine(resources, "player", "player.html"));
                page.UseShellExecute = true;
                Process.Start(page);
                return 0;
            }
#endif
            ProcessStartInfo start = new ProcessStartInfo(runtime);
            start.UseShellExecute = false;
            start.WorkingDirectory = Environment.CurrentDirectory;
            if (string.IsNullOrEmpty(start.EnvironmentVariables["IRUDD_AGENT_COMMAND"]))
                start.EnvironmentVariables["IRUDD_AGENT_COMMAND"] = Path.Combine(root, "bin", "irudd.exe");
#if IRUDD_CLI
            string entry = "irudd.mjs";
            int skip = 0;
            if (args.Length > 0 && args[0] == "host") { entry = "irudd-host.mjs"; skip = 1; }
            else if (args.Length > 0 && args[0] == "mcp") { entry = "irudd-mcp.mjs"; skip = 1; }
            start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
            StringBuilder line = new StringBuilder("--no-warnings=ExperimentalWarning ");
            line.Append(Quote(Path.Combine(resources, "dist", "clients", entry)));
            for (int i = skip; i < args.Length; i++) line.Append(' ').Append(Quote(args[i]));
            start.Arguments = line.ToString();
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
            using (Process child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
#else
            // Start through the shell so the app inherits no console or pipe handles: a
            // caller waiting for this launcher's output must not wait for the app to exit.
            // The app takes its environment from this process.
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", null);
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("IRUDD_AGENT_COMMAND")))
                Environment.SetEnvironmentVariable("IRUDD_AGENT_COMMAND", Path.Combine(root, "bin", "irudd.exe"));
            ProcessStartInfo shell = new ProcessStartInfo(runtime, Join(args));
            shell.UseShellExecute = true;
            shell.WorkingDirectory = Environment.CurrentDirectory;
            using (Process.Start(shell)) { }
            return 0;
#endif
        }
        catch (Exception error)
        {
#if IRUDD_CLI
            Console.Error.WriteLine("irudd: " + error.Message);
#else
            if (Environment.GetEnvironmentVariable("IRUDD_LAUNCHER_QUIET") == "1" || (args.Length > 0 && args[0] == "--create-shortcut"))
                Console.Error.WriteLine(error.Message);
            else
                MessageBox(IntPtr.Zero, error.Message, "Irudd Workshop", 0x10);
#endif
            return 1;
        }
    }

    private static string Join(string[] args)
    {
        StringBuilder line = new StringBuilder();
        foreach (string arg in args)
        {
            if (line.Length > 0) line.Append(' ');
            line.Append(Quote(arg));
        }
        return line.ToString();
    }

    internal static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { backslashes++; continue; }
            result.Append('\\', character == '"' ? backslashes * 2 + 1 : backslashes);
            result.Append(character);
            backslashes = 0;
        }
        result.Append('\\', backslashes * 2);
        return result.Append('"').ToString();
    }

    private static string ResolveBuild(string root)
    {
        string state = Path.Combine(root, "installation.json");
        if (!File.Exists(state)) return ResolveDirectory(Path.Combine(root, "current"));
        string text = null;
        for (int attempt = 0; text == null; attempt++)
        {
            try
            {
                // Share delete so the activator's replacing rename never waits for a launch.
                using (FileStream stream = new FileStream(state, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    text = reader.ReadToEnd();
            }
            catch (IOException)
            {
                if (attempt >= 40) throw;
                Thread.Sleep(50);
            }
        }
        Match current = Regex.Match(text, @"""current""\s*:\s*""([0-9a-f]{40})""");
        if (!current.Success) throw new IOException("No version is active. Run install.ps1 again.");
        return Path.Combine(Path.Combine(root, "builds"), current.Groups[1].Value);
    }

    private static string ResolveDirectory(string path)
    {
        using (SafeFileHandle handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new IOException("The active build is unavailable. Retry, or run install.ps1 again.");
            StringBuilder resolved = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, resolved, (uint)resolved.Capacity, 0);
            if (length == 0 || length >= resolved.Capacity) throw new IOException("Could not find the active build.");
            string result = resolved.ToString();
            if (result.StartsWith(@"\\?\UNC\")) return @"\\" + result.Substring(8);
            return result.StartsWith(@"\\?\") ? result.Substring(4) : result;
        }
    }

#if !IRUDD_CLI
    private static void WaitFor(int pid)
    {
        try
        {
            using (Process previous = Process.GetProcessById(pid))
            {
                if (!previous.WaitForExit(120000)) throw new IOException("The previous version did not close. Close it and open the app again.");
            }
        }
        catch (ArgumentException)
        {
            // Already exited.
        }
    }

    private static void CreateShortcut(string executable, string destination, string description, string arguments)
    {
        IShellLink link = (IShellLink)new ShellLink();
        link.SetPath(executable);
        link.SetArguments(arguments);
        link.SetDescription(description);
        link.SetWorkingDirectory(Path.GetDirectoryName(executable));
        link.SetIconLocation(executable, 0);
        IPropertyStore properties = (IPropertyStore)link;
        PropertyKey key = new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
        PropVariant value = new PropVariant { Type = 31, Pointer = Marshal.StringToCoTaskMemUni(AppId) };
        try { properties.SetValue(ref key, ref value); properties.Commit(); }
        finally { Marshal.FreeCoTaskMem(value.Pointer); }
        ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(destination, true);
        Marshal.FinalReleaseComObject(link);
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")] private class ShellLink { }
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLink
    {
        void GetPath(IntPtr file, int count, IntPtr findData, uint flags);
        void GetIDList(out IntPtr id);
        void SetIDList(IntPtr id);
        void GetDescription(IntPtr name, int count);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory(IntPtr directory, int count);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments(IntPtr arguments, int count);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation(IntPtr icon, int count, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string icon, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }
    [StructLayout(LayoutKind.Sequential)] private struct PropertyKey { public Guid Format; public uint Id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] private struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBox(IntPtr window, string text, string title, uint type);
#endif

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
}
