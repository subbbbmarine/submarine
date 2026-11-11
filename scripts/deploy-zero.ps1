# Deploys Submarine's contracts to Zero and writes contracts\deployments\<chain id>.json, which the indexer, keeper and site read.
#   powershell -ExecutionPolicy Bypass -File "D:\10 проектов\launchpad-lrzr\scripts\deploy-zero.ps1"
# By default it uses Zero's testnet as LayerZero lists it (chain 1337). That RPC only answers callers LayerZero has let in, so
# if they give you a different address, pass it: -Rpc <url>. The key must hold some ZRO on that network for gas.
# It asks for the key, which doesn't show on screen or stay in the command history. -DryRun simulates and sends nothing.
# -Resume finishes a deploy that stopped partway.
param([string]$Rpc = 'https://testnet.zero.layerzero.network', [switch]$DryRun, [switch]$Resume)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $env:USERPROFILE '.foundry\bin'
$forge = Join-Path $bin 'forge.exe'
$cast = Join-Path $bin 'cast.exe'
$pattern = '^(0x)?[0-9a-fA-F]{64}$'

$chainId = ((& $cast chain-id --rpc-url $Rpc 2>$null) | Select-Object -First 1)
if (-not $chainId) { throw "Zero's RPC at $Rpc does not answer. LayerZero lets builders in one by one: ask them for access, or pass the address they gave you with -Rpc. Nothing was sent." }
$chainId = $chainId.Trim()
Write-Host "Network $Rpc, chain $chainId"

$key = $env:PRIVATE_KEY
if ($key -notmatch $pattern) {
  $secure = Read-Host 'Paste the private key and press Enter (it will not show)' -AsSecureString
  $key = (New-Object System.Net.NetworkCredential('', $secure)).Password.Trim()
}
if ($key -notmatch $pattern) { throw 'That is not a private key. It should be 64 hex characters, with or without 0x. Nothing was sent.' }
if (-not $key.StartsWith('0x')) { $key = "0x$key" }

$address = (& $cast wallet address --private-key $key).Trim()
$balance = (& $cast balance $address --ether --rpc-url $Rpc).Trim()
Write-Host "From $address, holding $balance ZRO"
if (-not $DryRun -and [double]::Parse($balance, [System.Globalization.CultureInfo]::InvariantCulture) -le 0) {
  throw 'This address has no ZRO on this network, and the deploy needs some for gas. Nothing was sent.'
}

# --gas-estimate-multiplier 130: a call that clears storage (Router.finishSetup) needs more gas while it runs than the estimate,
# which counts the refund. The price is what the node asks for in eth_gasPrice.
$gasPrice = ((& $cast gas-price --rpc-url $Rpc) | Select-Object -First 1).Trim()
Write-Host "Gas price $gasPrice wei"
$forgeArgs = @('script', 'script/Deploy.s.sol', '--rpc-url', $Rpc, '--slow', '--gas-estimate-multiplier', '130', '--with-gas-price', $gasPrice)
if (-not $DryRun) { $forgeArgs += '--broadcast' }
if ($Resume) { $forgeArgs += '--resume' }

$env:PRIVATE_KEY = $key
Push-Location (Join-Path $root 'contracts')
try {
  & $forge @forgeArgs
  $exit = $LASTEXITCODE
} finally {
  Pop-Location
  Remove-Item Env:PRIVATE_KEY -ErrorAction SilentlyContinue
}

if ($DryRun) {
  if ($exit -ne 0) { throw "The dry run stopped with an error. Copy what's above." }
  Write-Host ''
  Write-Host 'Dry run passed. Nothing was sent.'
  return
}

# Forge writes the file before it sends anything, so a failed send leaves addresses for contracts that don't exist. The indexer
# and the site trust that file, so only the chain decides whether it stays.
$file = Join-Path $root "contracts\deployments\$chainId.json"
Start-Sleep -Seconds 3
$missing = @()
if (Test-Path $file) {
  $deployment = Get-Content $file -Raw | ConvertFrom-Json
  foreach ($name in 'vault', 'pools', 'launchpad', 'router', 'limitOrders', 'referrals', 'copyVault') {
    $code = ((& $cast code $deployment.$name --rpc-url $Rpc) | Select-Object -First 1).Trim()
    if (-not $code -or $code -eq '0x') { $missing += $name }
  }
} else {
  $missing += 'the deployment file'
}
if ($missing.Count -gt 0) {
  Remove-Item $file -ErrorAction SilentlyContinue
  throw "Not deployed. Missing on Zero: $($missing -join ', '). Send a screenshot of what's above. If some contracts went out, this finishes them: add -Resume to the same command."
}
Write-Host ''
Write-Host "DEPLOYED. All seven contracts are on Zero. Addresses are in contracts\deployments\$chainId.json"
