# Builds a "Galleria" shortcut on your Desktop with an icon, on Windows.
# Run once from the project folder:  npm run make-app
# (or:  powershell -ExecutionPolicy Bypass -File scripts\make-launcher.ps1)
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$Ico  = Join-Path $ScriptDir 'galleria.ico'

Write-Host "Building Galleria shortcut  (points at: $Repo)"

# 1. Icon: SVG -> .ico, using the app's own sharp dependency.
& node (Join-Path $ScriptDir 'make-ico.mjs') (Join-Path $ScriptDir 'icon.svg') $Ico

# 2. Desktop shortcut that runs `npm start` in the project folder.
$Desktop = [Environment]::GetFolderPath('Desktop')
$LnkPath = Join-Path $Desktop 'Galleria.lnk'
$Shell = New-Object -ComObject WScript.Shell
$Lnk = $Shell.CreateShortcut($LnkPath)
$Lnk.TargetPath       = $env:ComSpec            # cmd.exe
$Lnk.Arguments        = '/c npm start'
$Lnk.WorkingDirectory = $Repo
$Lnk.IconLocation     = $Ico
$Lnk.WindowStyle      = 7                        # start minimized
$Lnk.Description       = 'Launch Galleria'
$Lnk.Save()

Write-Host "Done -> $LnkPath"
Write-Host "Double-click it, or right-click it -> Pin to taskbar / Start."
