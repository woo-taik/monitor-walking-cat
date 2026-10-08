param(
    [switch]$Verify,
    [ValidateSet('windows', 'mac', 'both')][string]$Target = 'windows'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!(Test-Path -LiteralPath '.\node_modules')) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (!(Test-Path -LiteralPath '.\node_modules\electron\dist\electron.exe')) {
    node .\node_modules\electron\install.js
    if ($LASTEXITCODE -ne 0) { throw 'Electron runtime installation failed.' }
}
if ($Verify) {
    npm run verify
    if ($LASTEXITCODE -ne 0) { throw 'Verification failed. See artifacts/electron-verification.' }
}
if ($Target -in @('windows', 'both')) {
    npm run package:win
    if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
}
if ($Target -in @('mac', 'both')) {
    npm run package:mac
    if ($LASTEXITCODE -ne 0) { throw 'Mac packaging failed.' }
}
