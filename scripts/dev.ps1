$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $portableNode = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.tools') -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $portableNode) { throw 'Install Node.js LTS (see .nvmrc), then run npm install.' }
    $env:Path = $portableNode.DirectoryName + ';' + $env:Path
}
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
& npm.cmd run dev
exit $LASTEXITCODE
