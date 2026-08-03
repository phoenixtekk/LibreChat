# Amy desktop agent — opens URLs that Amy hands over, in this logon session.
#
# Long-polls the AiBox desk bridge. Polling (rather than accepting inbound
# connections) means no Windows Firewall rule is needed and nothing breaks when
# this machine's IP changes. Because it runs inside the interactive session, the
# browser window actually appears on screen.

$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$TokenFile = Join-Path $Root 'token.txt'
$LogFile   = Join-Path $Root 'amy-bridge.log'
$Bridge    = if ($env:AMY_BRIDGE) { $env:AMY_BRIDGE } else { 'http://192.168.166.168:8824' }

# Only ever run one copy, however many times the shortcut is triggered.
$mutex = New-Object System.Threading.Mutex($false, 'Global\AmyDesktopBridge')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Write-Log($message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Add-Content -Path $LogFile -Value $line
    if ((Get-Item $LogFile -ErrorAction SilentlyContinue).Length -gt 1MB) {
        Set-Content -Path $LogFile -Value (Get-Content $LogFile -Tail 200)
    }
}

if (-not (Test-Path $TokenFile)) { Write-Log "no token.txt beside the script - exiting"; exit 1 }
$Token = (Get-Content $TokenFile -Raw).Trim()

Write-Log "started; polling $Bridge"
$backoff = 5

while ($true) {
    try {
        $uri = "{0}/pending?token={1}" -f $Bridge, [uri]::EscapeDataString($Token)
        $response = Invoke-RestMethod -Uri $uri -TimeoutSec 40 -ErrorAction Stop
        $backoff = 5

        if ($response -and $response.url) {
            $url = [string]$response.url
            # Defence in depth: the bridge already filters, but never hand the
            # shell anything that isn't an ordinary web URL.
            if ($url -match '^https?://[^\s"'']+$') {
                Write-Log "opening $url"
                Start-Process $url
            } else {
                Write-Log "refused non-web url: $url"
            }
        }
    } catch {
        # A poll that times out with no work is normal; anything else backs off.
        Write-Log ("poll failed: " + $_.Exception.Message)
        Start-Sleep -Seconds $backoff
        $backoff = [Math]::Min($backoff * 2, 60)
    }
}
