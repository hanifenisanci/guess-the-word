param(
  [Parameter(Mandatory=$true)] [string] $UserId1,
  [Parameter(Mandatory=$true)] [string] $UserId2
)

$room = Invoke-RestMethod -Uri 'http://localhost:3002/rooms' -Method Post

$body1 = @{ userId = $UserId1 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3002/rooms/$($room.id)/join" -Method Put -Body $body1 -ContentType 'application/json'

$body2 = @{ userId = $UserId2 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3002/rooms/$($room.id)/join" -Method Put -Body $body2 -ContentType 'application/json'

Write-Output $room
