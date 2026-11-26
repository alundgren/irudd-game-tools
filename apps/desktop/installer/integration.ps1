param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Programs,
    [Parameter(Mandatory = $true)][ValidateSet('apply', 'remove')][string]$Action,
    [switch]$NoPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$launcher = Join-Path $Root 'Irudd Workshop.exe'
$bin = Join-Path $Root 'bin'
$shortcuts = @(
    @{ Name = 'Irudd Workshop.lnk'; Description = 'Irudd Workshop'; Arguments = @() },
    @{ Name = 'Irudd Player.lnk'; Description = 'Irudd Workshop offline GLB player'; Arguments = @('--player') }
)

function Test-Owned([string]$Shortcut) {
    $shell = New-Object -ComObject WScript.Shell
    return $shell.CreateShortcut($Shortcut).TargetPath -ieq $launcher
}

function Set-UserPath([string]$Mode) {
    if ($NoPath) { return }
    Add-Type -Namespace Irudd -Name Environment -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
'@
    $registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try {
        $value = [string]$registry.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $entries = if ($value) { @($value -split ';' | Where-Object { $_ }) } else { @() }
        $others = @($entries | Where-Object { $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
        $next = if ($Mode -eq 'apply') { $others + $bin } else { $others }
        if (($next -join ';') -ne ($entries -join ';')) {
            $kind = if ($registry.GetValueNames() -contains 'Path') { $registry.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
            $registry.SetValue('Path', ($next -join ';'), $kind)
            $result = [UIntPtr]::Zero
            [Irudd.Environment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
        }
    } finally { $registry.Dispose() }
}

New-Item -ItemType Directory -Force -Path $Programs | Out-Null
foreach ($entry in $shortcuts) {
    $shortcut = Join-Path $Programs $entry.Name
    if ((Test-Path -LiteralPath $shortcut) -and -not (Test-Owned $shortcut)) {
        throw "$shortcut belongs to another application. Move it aside and retry."
    }
    if ($Action -eq 'remove') {
        if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
        continue
    }
    $arguments = @('--create-shortcut', $shortcut, $entry.Description) + $entry.Arguments
    $process = Start-Process -FilePath $launcher -ArgumentList ($arguments | ForEach-Object { '"' + $_ + '"' }) -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Could not create the Start menu shortcut $($entry.Name)." }
}
Set-UserPath $Action
