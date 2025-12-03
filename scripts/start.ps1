$roomId = $args[0]
if (-not $roomId) { Write-Error "Usage: .\start.ps1 <roomId>"; exit 1 }
$res = Invoke-RestMethod -Uri "http://localhost:3002/rooms/$roomId/start" -Method Post
Write-Output $res
