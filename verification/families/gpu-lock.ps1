param([Parameter(Mandatory=$true)][string] $Program, [Parameter(ValueFromRemainingArguments=$true)][string[]] $Arguments)
# Run one hardware-browser job at a time on this PC: PROGRAM ARGS under the shared GPU lock.
# Same mutex as verification/baseline/gpu-lock.ps1 and the workshop QA wrapper, so textured
# family exports queue behind other sessions' renders instead of competing for the GPU.
$lock=[System.Threading.Mutex]::new($false,'Local\ShapeFirstWorkshopBrowser')
$held=$false
try {
  try { $held=$lock.WaitOne() } catch [System.Threading.AbandonedMutexException] { $held=$true }
  & $Program @Arguments
  $result=$LASTEXITCODE
} finally { if ($held) { $lock.ReleaseMutex() }; $lock.Dispose() }
exit $result
