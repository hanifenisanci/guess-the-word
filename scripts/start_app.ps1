# Starts the unified app-server in a background PowerShell job and shows status
Param(
  [string]$ServerDir = "c:\Users\nisan\Desktop\guess-the-word\app-server"
)

Write-Host "Starting app-server in background job..."
Push-Location $ServerDir
$npm = Test-Path (Join-Path $ServerDir "node_modules")
if (-not $npm) { npm install }
Start-Job -Name GuessServer -ScriptBlock { param($dir) Push-Location $dir; node "$dir\index.js" } -ArgumentList $ServerDir | Out-Null
Start-Sleep -Seconds 1
Pop-Location

Write-Host "Server job started as 'GuessServer'."
Write-Host "Check status: Get-Job -Name GuessServer | Format-List"
Write-Host "Health check: Invoke-RestMethod -Uri 'http://localhost:3000/health' -Method Get"
Write-Host "Stop later: Stop-Job -Name GuessServer; Remove-Job -Name GuessServer"
