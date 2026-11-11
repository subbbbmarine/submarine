# Starts the whole stack on a throwaway local chain: anvil, contracts, demo data, indexer, keeper, web.
#   powershell -ExecutionPolicy Bypass -File "D:\10 проектов\launchpad-lrzr\scripts\dev-local.ps1"
# Stop everything with stop-local.ps1 next to this file.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root '.local'
New-Item -ItemType Directory -Force $logs | Out-Null
$pidFile = Join-Path $logs 'pids.txt'
if (Test-Path $pidFile) { & (Join-Path $PSScriptRoot 'stop-local.ps1') }

$foundry = Join-Path $env:USERPROFILE '.foundry\bin'
$rpc = 'http://127.0.0.1:8546'
# Anvil's public default test keys. They only ever control local test accounts.
$deployerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
$keeperKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

function Start-Bg($name, $file, $argList, $cwd) {
  $p = Start-Process -FilePath $file -ArgumentList $argList -WorkingDirectory $cwd -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$name.log") -RedirectStandardError (Join-Path $logs "$name.err.log")
  Add-Content $pidFile $p.Id
  Write-Host "started $name (pid $($p.Id))"
}

# Start the chain ten hours in the past: the seed script walks it forward so charts have real history, and must end before now.
$past = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 36000
Start-Bg 'anvil' (Join-Path $foundry 'anvil.exe') @('--port', '8546', '--chain-id', '31337', '--accounts', '20', '--balance', '1000000', '--block-base-fee-per-gas', '0', '--gas-price', '1000000', '--timestamp', "$past", '--silent') $root
$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 300
  try { $null = Invoke-RestMethod -Uri $rpc -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'; $up = $true } catch { $up = $false }
} until ($up -or (Get-Date) -gt $deadline)
if (-not $up) { throw 'anvil did not start' }

Remove-Item -LiteralPath (Join-Path $root 'indexer\data\indexer-31337.db') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $root 'indexer\data\indexer-31337.db-wal') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $root 'indexer\data\indexer-31337.db-shm') -Force -ErrorAction SilentlyContinue

Write-Host 'deploying contracts'
$env:PRIVATE_KEY = $deployerKey
Push-Location (Join-Path $root 'contracts')
$ErrorActionPreference = 'Continue'
& (Join-Path $foundry 'forge.exe') script script/Deploy.s.sol --rpc-url $rpc --broadcast --slow *> (Join-Path $logs 'deploy.log')
$ErrorActionPreference = 'Stop'
Pop-Location
if (-not (Test-Path (Join-Path $root 'contracts\deployments\31337.json'))) { throw 'deploy failed, see .local\deploy.log' }

$env:CHAIN_ID = '31337'
$env:RPC_URL = $rpc
$env:SYNC_TAG = 'latest'
$env:KEEPER_PRIVATE_KEY = $keeperKey
# Its own ports, so it can run beside another local stack.
$env:PORT = '3011'; $env:CORS_ORIGIN = 'http://localhost:3010'; $env:PUBLIC_API_URL = 'http://localhost:3011'

@"
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=$rpc
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8546
NEXT_PUBLIC_API_URL=http://localhost:3011
"@ | Set-Content (Join-Path $root 'web\.env.local') -Encoding ascii

Write-Host 'seeding demo data'
& node (Join-Path $root 'scripts\seed-local.mjs')
if ($LASTEXITCODE -ne 0) { throw 'seed failed' }

$tsx = Join-Path $root 'node_modules\.bin\tsx.cmd'
Start-Bg 'indexer' $tsx @('src/index.ts') (Join-Path $root 'indexer')
Start-Bg 'keeper' $tsx @('src/index.ts') (Join-Path $root 'keeper')
Start-Bg 'market' 'node' @('scripts/seed-live.mjs') $root
Start-Bg 'web' (Join-Path $root 'node_modules\.bin\next.cmd') @('dev', '-p', '3010') (Join-Path $root 'web')

Write-Host ''
Write-Host 'Ready: http://localhost:3010   (logs in .local)'
