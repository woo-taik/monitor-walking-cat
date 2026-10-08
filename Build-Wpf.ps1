# Previous Windows-only implementation, retained for comparison or rollback.
param([switch]$Verify)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$animoSdk = Join-Path $env:LOCALAPPDATA 'Animo\dotnet-sdk\dotnet.exe'
if (!(Test-Path -LiteralPath $animoSdk)) { $animoSdk = (Get-Command dotnet -ErrorAction Stop).Source }
$animoPackageSource = Join-Path $PSScriptRoot '.tools\packages'
New-Item -ItemType Directory -Force -Path $animoPackageSource | Out-Null
& $animoSdk publish .\Animo.csproj -c Release -r win-x64 --self-contained false --source $animoPackageSource -p:NuGetAudit=false -o .\artifacts\Animo
if ($LASTEXITCODE -ne 0) { throw 'WPF build failed.' }
if ($Verify) {
    $animoOutput = Join-Path $PSScriptRoot 'artifacts\verification'
    foreach ($animoMode in @('--self-test', '--smoke-test')) {
        $animoProcess = Start-Process -FilePath '.\artifacts\Animo\Animo.exe' -ArgumentList @($animoMode, '--output', ('"' + $animoOutput + '"')) -WindowStyle Hidden -Wait -PassThru
        if ($animoProcess.ExitCode -ne 0) { throw "WPF verification failed: $animoMode" }
    }
}
