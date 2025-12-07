# Launches the CLI client in the current window
Param(
  [string]$CliDir = "c:\Users\nisan\Desktop\guess-the-word\cli-client"
)

Push-Location $CliDir
$npm = Test-Path (Join-Path $CliDir "node_modules")
if (-not $npm) { npm install }
node index.js
Pop-Location
