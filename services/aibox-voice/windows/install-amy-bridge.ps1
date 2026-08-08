# Install the Amy desktop agent for the CURRENT user.
#
# Runs per-user (no admin needed) and starts at logon, so the agent lives in the
# interactive session where opening a browser actually shows a window.
#
#   .\install-amy-bridge.ps1 -Token '<token from /opt/voice/bridge.token>'

param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Bridge = 'http://192.168.166.168:8824',
    [string]$InstallDir = "$env:LOCALAPPDATA\AmyBridge"
)

$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'amy-bridge.ps1'

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item $source (Join-Path $InstallDir 'amy-bridge.ps1') -Force

$tokenPath = Join-Path $InstallDir 'token.txt'
Set-Content -Path $tokenPath -Value $Token -NoNewline
# Token is a credential: restrict it to this user. Grant by SID — a bare
# username does not resolve reliably for domain accounts, and dropping
# inheritance without a valid grant locks the owner out of their own file.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls $tokenPath /inheritance:r /grant:r "*${sid}:(R,W)" | Out-Null

$startup  = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'Amy Desktop Bridge.lnk'
$wsh = New-Object -ComObject WScript.Shell
$link = $wsh.CreateShortcut($shortcut)
$link.TargetPath = (Get-Command powershell.exe).Source
$link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\amy-bridge.ps1`""
$link.WorkingDirectory = $InstallDir
$link.Description = 'Opens web pages that Amy hands over from the AiBox'
$link.Save()

[Environment]::SetEnvironmentVariable('AMY_BRIDGE', $Bridge, 'User')

Write-Output "Installed to $InstallDir"
Write-Output "Autostart shortcut: $shortcut"
Write-Output "Bridge: $Bridge"
Write-Output "Start it now with:  Start-Process powershell -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File','$InstallDir\amy-bridge.ps1'"
