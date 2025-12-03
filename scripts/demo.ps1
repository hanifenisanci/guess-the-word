# End-to-end demo: register two users, create/join room, start, make guesses

Write-Host "Registering users..." -ForegroundColor Cyan
$alice = Invoke-RestMethod -Uri 'http://localhost:3001/users' -Method Post -Body (@{ username = 'Alice' } | ConvertTo-Json) -ContentType 'application/json'
$bob   = Invoke-RestMethod -Uri 'http://localhost:3001/users' -Method Post -Body (@{ username = 'Bob' } | ConvertTo-Json) -ContentType 'application/json'
Write-Host "Alice: $($alice.id)  Bob: $($bob.id)" -ForegroundColor Cyan

Write-Host "Creating room..." -ForegroundColor Cyan
$room = Invoke-RestMethod -Uri 'http://localhost:3002/rooms' -Method Post
Write-Host "Room: $($room.id)" -ForegroundColor Cyan

Write-Host "Joining room..." -ForegroundColor Cyan
Invoke-RestMethod -Uri "http://localhost:3002/rooms/$($room.id)/join" -Method Put -Body (@{ userId = $alice.id } | ConvertTo-Json) -ContentType 'application/json' | Out-Null
Invoke-RestMethod -Uri "http://localhost:3002/rooms/$($room.id)/join" -Method Put -Body (@{ userId = $bob.id } | ConvertTo-Json) -ContentType 'application/json' | Out-Null

Write-Host "Starting game..." -ForegroundColor Cyan
$start = Invoke-RestMethod -Uri "http://localhost:3002/rooms/$($room.id)/start" -Method Post
Write-Host "Game: $($start.gameId)  CurrentTurn: $($start.currentTurn)" -ForegroundColor Cyan

# Helper to guess and print state
function Guess($userId, $letter) {
  $res = Invoke-RestMethod -Uri "http://localhost:3002/rooms/$($room.id)/guess" -Method Post -Body (@{ userId = $userId; letter = $letter } | ConvertTo-Json) -ContentType 'application/json'
  Write-Host "Guess '$letter' by $userId -> revealed=$($res.revealed) attempts=$($res.remainingAttempts) status=$($res.status) nextTurn=$($res.currentTurn)" -ForegroundColor Yellow
}

Write-Host "Making a few guesses..." -ForegroundColor Cyan
if ($start.currentTurn -eq $alice.id) {
  Guess $alice.id 'a'; Guess $bob.id 'e'; Guess $alice.id 'i'
} else {
  Guess $bob.id 'a'; Guess $alice.id 'e'; Guess $bob.id 'i'
}

Write-Host "Demo finished. Check CLI/Web for WS events." -ForegroundColor Green
