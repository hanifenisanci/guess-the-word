$username = $args[0]
if (-not $username) { Write-Error "Usage: .\register.ps1 <username>"; exit 1 }
$body = @{ username = $username } | ConvertTo-Json
$user = Invoke-RestMethod -Uri 'http://localhost:3001/users' -Method Post -Body $body -ContentType 'application/json'
Write-Output $user
