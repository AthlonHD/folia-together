# scripts/passthrough-tone-test.ps1
# Tone test in one short command with no `$` in it (so it survives being pasted into cmd or PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/AthlonHD/folia-together/stage-remote/scripts/passthrough-tone-test.ps1 | iex"
# It sets the mode and runs the main script (scripts/start-passthrough.ps1) from GitHub.
$env:FOLIA_PASSTHROUGH_MODE = 'tone'
irm 'https://raw.githubusercontent.com/AthlonHD/folia-together/stage-remote/scripts/start-passthrough.ps1' | iex
Write-Host ''
Write-Host 'Done. You can close this window.' -ForegroundColor Green
