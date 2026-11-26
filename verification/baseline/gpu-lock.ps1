param([Parameter(ValueFromRemainingArguments=$true)][string[]] $Arguments)
# Run one hardware-browser job at a time on this PC: python ARGS under the shared GPU lock.
# The mutex name is the one the existing workshop QA wrapper uses
# (shape-first/.reference-cache/quality-80/run-qa.ps1), so G0 captures queue behind
# other sessions' renders instead of competing for the GPU.
# usage: powershell -NoProfile -File verification/baseline/gpu-lock.ps1 verification/baseline/browser.py ...
$lock=[System.Threading.Mutex]::new($false,'Local\ShapeFirstWorkshopBrowser')
$held=$false
try {
  try { $held=$lock.WaitOne() } catch [System.Threading.AbandonedMutexException] { $held=$true }
  python @Arguments
  $result=$LASTEXITCODE
} finally { if ($held) { $lock.ReleaseMutex() }; $lock.Dispose() }
exit $result
