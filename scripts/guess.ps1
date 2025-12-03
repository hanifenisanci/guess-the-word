param(
  [Parameter(Mandatory=$true)] [string] $RoomId,
  [Parameter(Mandatory=$true)] [string] $UserId,
  [Parameter(Mandatory=$true)] [string] $Letter
)

$body = @{ userId = $UserId; letter = $Letter } | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://localhost:3002/rooms/$RoomId/guess" -Method Post -Body $body -ContentType 'application/json'
Write-Output $res
