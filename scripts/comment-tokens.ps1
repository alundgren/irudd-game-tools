$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
foreach ($file in $args) {
    $source = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $file)))
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
    foreach ($token in $tokens) {
        if ($token.Kind -eq 'Comment' -and $token.Text -notmatch '^#requires\s') {
            $start = $token.Extent.StartOffset
            $end = $token.Extent.EndOffset
            @{ file = $file; text = $token.Text; range = @{
                start = @{ line = $token.Extent.StartLineNumber - 1 }
                byteOffset = @{
                    start = [Text.Encoding]::UTF8.GetByteCount($source.Substring(0, $start))
                    end = [Text.Encoding]::UTF8.GetByteCount($source.Substring(0, $end))
                }
            }} | ConvertTo-Json -Depth 4 -Compress
        }
    }
}
