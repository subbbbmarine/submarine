# Stops everything dev-local.ps1 started.
$pidFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.local\pids.txt'
if (Test-Path $pidFile) {
  # The file can outlive what it lists, and Windows reuses ids, so only something that could be ours gets stopped.
  foreach ($id in Get-Content $pidFile) {
    $found = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($found -and $found.ProcessName -match '^(node|cmd|anvil|conhost)$') { & taskkill.exe /PID $id /T /F *> $null }
  }
  Remove-Item -LiteralPath $pidFile -Force
}
Write-Host 'stopped'
