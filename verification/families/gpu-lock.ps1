param([Parameter(Mandatory=$true)][string] $Program, [Parameter(ValueFromRemainingArguments=$true)][string[]] $Arguments)
$lock=[System.Threading.Mutex]::new($false,'Local\ShapeFirstWorkshopBrowser')
$held=$false
try {
  try { $held=$lock.WaitOne() } catch [System.Threading.AbandonedMutexException] { $held=$true }
  & $Program @Arguments
  $result=$LASTEXITCODE
} finally { if ($held) { $lock.ReleaseMutex() }; $lock.Dispose() }
exit $result
