param([ValidatePattern('^[0-9a-f]{40}$')][string]$Prepare)
# Install or update Irudd Workshop for the current Windows user.
#
# The installer keeps its own clone of the repository, builds the pinned
# branch commit on this computer from the frozen lockfile and switches the
# Start menu entry and the `irudd` command to the new build. Without
# -Prepare it installs, activates and opens the app. With -Prepare <commit>
# (run by the app's updater) it only builds that commit and records it as
# prepared; the app activates it when the person restarts. A failed or
# canceled build never changes the active version.
#
# Environment (all optional):
#   IRUDD_INSTALL_ROOT  installation folder (default %LOCALAPPDATA%\irudd-game-tools)
#   IRUDD_REPOSITORY    Git origin (default https://github.com/alundgren/irudd-game-tools.git)
#   IRUDD_BRANCH        branch to follow (default main)
#   IRUDD_VP            an existing Vite+ executable; otherwise vp.exe on PATH or a new install
#   IRUDD_START_MENU    folder for the Start menu shortcuts (default: the user's Programs folder)
#   IRUDD_NO_PATH=1     leave the user PATH unchanged
#   IRUDD_NO_LAUNCH=1   do not open the app after installing

function Install-IruddWorkshop {
    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version Latest
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or [Environment]::OSVersion.Version.Build -lt 22000 -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64' -or -not [Environment]::Is64BitProcess) {
        throw 'Irudd Workshop requires Windows 11 x64. Run this installer in a 64-bit PowerShell terminal.'
    }
    $Commit = $Prepare
    $repository = if ($env:IRUDD_REPOSITORY) { $env:IRUDD_REPOSITORY } else { 'https://github.com/alundgren/irudd-game-tools.git' }
    $branch = if ($env:IRUDD_BRANCH) { $env:IRUDD_BRANCH } else { 'main' }
    if ($branch -notmatch '^[\w./-]{1,200}$') { throw 'IRUDD_BRANCH is not a branch name.' }
    $root = if ($env:IRUDD_INSTALL_ROOT) { $env:IRUDD_INSTALL_ROOT } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'irudd-game-tools' }
    if ($root -notmatch '^[A-Za-z]:[\\/]') { throw 'IRUDD_INSTALL_ROOT must be an absolute folder on a local drive.' }
    $root = [IO.Path]::GetFullPath($root).TrimEnd('\')
    if ($root.Length -le 3) { throw 'Choose an installation folder, not the root of a drive.' }
    $programs = if ($env:IRUDD_START_MENU) { $env:IRUDD_START_MENU } else { [Environment]::GetFolderPath('Programs') }
    $gitCommand = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $gitCommand) { throw 'Install Git for Windows, open a new PowerShell terminal and run this installer again.' }
    $git = $gitCommand.Source
    $powerShell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $source = Join-Path $root 'source'
    $builds = Join-Path $root 'builds'
    $app = 'Irudd Workshop'
    $staging = $null
    $bootstrap = $null
    $lock = $null
    $saved = @{}
    foreach ($name in @('PATH', 'CI', 'GIT_TERMINAL_PROMPT', 'ELECTRON_RUN_AS_NODE', 'IRUDD_INSTALL_ROOT', 'IRUDD_REPOSITORY', 'IRUDD_BRANCH', 'IRUDD_VP', 'VP_HOME', 'VP_VERSION', 'VP_NODE_MANAGER')) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    function Invoke-Native([string]$Executable, [string[]]$Arguments) {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($Executable)) exited with code $LASTEXITCODE." }
    }
    function Invoke-Activator([string]$Build, [string]$Mode) {
        # The app executable is a GUI-subsystem program, which `&` would not wait for.
        $start = [Diagnostics.ProcessStartInfo]::new((Join-Path $Build "$app\$app.exe"))
        $start.UseShellExecute = $false
        $start.Arguments = '"{0}" {1} "{2}" "{3}"' -f (Join-Path $Build "$app\resources\app\dist\update\activate.mjs"), $Mode, $root, $Build
        $start.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
        $process = [Diagnostics.Process]::Start($start)
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "Could not $Mode the build $([IO.Path]::GetFileName($Build))." }
    }
    try {
        [IO.Directory]::CreateDirectory($builds) | Out-Null
        try {
            # Windows releases and deletes this lock even when a cancel kills the build.
            $lock = [IO.FileStream]::new((Join-Path $root '.install-lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None, 4096, [IO.FileOptions]::DeleteOnClose)
        } catch { throw 'Another Irudd Workshop install or update is running. Wait for it to finish and retry.' }
        Get-ChildItem -LiteralPath $builds -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^\.(preparing|removing)\.[0-9a-f]{32}$' } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
        $env:GIT_TERMINAL_PROMPT = '0'
        if (-not (Test-Path -LiteralPath (Join-Path $source '.git'))) {
            Write-Host "Cloning $repository ($branch)..."
            Invoke-Native $git @('clone', '--quiet', '--depth', '1', '--branch', $branch, $repository, $source)
        }
        $origin = & $git -C $source remote get-url origin
        if ($origin -ne $repository) { throw "The installation's source folder uses another Git remote ($origin). Move $source aside and retry." }
        $revision = if ($Commit) { $Commit } else { $branch }
        Write-Host "Fetching $revision..."
        Invoke-Native $git @('-C', $source, 'fetch', '--quiet', '--depth', '1', 'origin', $revision)
        $Commit = (& $git -C $source rev-parse FETCH_HEAD).Trim()
        if ($Commit -cnotmatch '^[0-9a-f]{40}$') { throw 'Git returned an invalid commit.' }
        # The installer owns this clone; an interrupted checkout is repaired, ignored build output kept.
        Invoke-Native $git @('-C', $source, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force', '--detach', $Commit)
        Invoke-Native $git @('-C', $source, 'clean', '--quiet', '-fd')

        $vp = $env:IRUDD_VP
        if (-not $vp) {
            $vpCommand = Get-Command vp.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($vpCommand) { $vp = $vpCommand.Source }
        }
        if (-not $vp -or -not (Test-Path -LiteralPath $vp -PathType Leaf)) {
            $workspace = Get-Content -LiteralPath (Join-Path $source 'pnpm-workspace.yaml') -Raw
            $version = [regex]::Match($workspace, '(?m)^  vite-plus: ([^\s]+)\s*$').Groups[1].Value
            if (-not $version) { throw 'The repository does not pin a Vite+ version.' }
            Write-Host "Installing Vite+ $version to build the app..."
            $bootstrap = Join-Path $root ('.vite-install-' + [Guid]::NewGuid().ToString('N') + '.ps1')
            Invoke-WebRequest -UseBasicParsing -Uri 'https://vite.plus/ps1' -OutFile $bootstrap -TimeoutSec 120
            $env:VP_HOME = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vite-plus'
            $env:VP_VERSION = $version
            $env:VP_NODE_MANAGER = 'no'
            $env:CI = 'true'
            Invoke-Native $powerShell @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $bootstrap)
            $vp = Join-Path $env:VP_HOME 'bin\vp.exe'
        }
        if ($vp -notmatch '^[A-Za-z]:[\\/]' -or [IO.Path]::GetExtension($vp) -ine '.exe' -or -not (Test-Path -LiteralPath $vp -PathType Leaf)) { throw 'Vite+ is unavailable. Install it from https://viteplus.dev and retry.' }
        $env:PATH = (Split-Path -Parent $vp) + ';' + $env:PATH
        $env:CI = 'true'
        $env:IRUDD_INSTALL_ROOT = $root
        $env:IRUDD_REPOSITORY = $repository
        $env:IRUDD_BRANCH = $branch
        $env:IRUDD_VP = $vp
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

        $build = Join-Path $builds $Commit
        if (-not (Test-Path -LiteralPath (Join-Path $build "$app\$app.exe") -PathType Leaf)) {
            Push-Location -LiteralPath $source
            try {
                Write-Host 'Installing build dependencies from the frozen lockfile...'
                Invoke-Native $vp @('install', '--frozen-lockfile')
                Write-Host 'Installing the pinned Electron runtime...'
                Invoke-Native $vp @('-C', 'apps/desktop', 'exec', 'install-electron')
                Write-Host "Building $($Commit.Substring(0, 12))..."
                $staging = Join-Path $builds ('.preparing.' + [Guid]::NewGuid().ToString('N'))
                Invoke-Native $vp @('node', '--import', './packages/document/test/support/register.ts', 'apps/desktop/scripts/package.ts', '--out', $staging)
                [IO.Directory]::Move($staging, $build)
                $staging = $null
            } finally { Pop-Location }
        }
        Invoke-Activator $build 'prepare'
        if ($Prepare) { Write-Host "Prepared $Commit. Restart the app to use it."; return }
        Invoke-Activator $build 'activate'
        $integration = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $build "$app\resources\app\bin\integration.ps1"), '-Root', $root, '-Programs', $programs, '-Action', 'apply')
        if ($env:IRUDD_NO_PATH -eq '1') { $integration += '-NoPath' }
        Invoke-Native $powerShell $integration
        Write-Host "Installed Irudd Workshop $($Commit.Substring(0, 12)). Open it from the Start menu; agents can run irudd from a new terminal."
        if ($env:IRUDD_NO_LAUNCH -ne '1') { Start-Process -FilePath (Join-Path $root "$app.exe") }
    } finally {
        if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
        if ($bootstrap -and (Test-Path -LiteralPath $bootstrap)) { Remove-Item -LiteralPath $bootstrap -Force -ErrorAction SilentlyContinue }
        if ($lock) { $lock.Dispose() }
        foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    }
}

Install-IruddWorkshop
