$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "release/Animo-$version-windows-x64.exe").Path
$installDir = Join-Path $env:LOCALAPPDATA 'Programs/Animo'
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Animo.lnk'

try {
    $result = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
    if ($result.ExitCode -ne 0) { throw "Installer exited with $($result.ExitCode)" }
    if (!(Test-Path -LiteralPath (Join-Path $installDir 'Animo.exe'))) { throw 'Installed executable missing' }
    if (!(Test-Path -LiteralPath $shortcut)) { throw 'Desktop shortcut missing' }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if ($target -ne (Join-Path $installDir 'Animo.exe')) { throw "Desktop shortcut target is wrong: $target" }
    if (!(Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo')) { throw 'Uninstall entry missing' }
} finally {
    $uninstaller = Join-Path $installDir 'Uninstall Animo.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $result = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($result.ExitCode -ne 0) { throw "Uninstaller exited with $($result.ExitCode)" }
    }
}

if (Test-Path -LiteralPath $shortcut) { throw 'Uninstaller left the Desktop shortcut' }
if (Test-Path -LiteralPath $installDir) { throw 'Uninstaller left the application folder' }
Write-Host 'Windows installer, Desktop shortcut and uninstaller verified.'
