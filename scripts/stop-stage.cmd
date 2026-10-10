@echo off
rem scripts/stop-stage.cmd
rem Stops the services started by start-stage.cmd by killing whatever listens on
rem ports 4000 / 4100 / 4300 / 3000. Browsers are left alone (close the Host Chrome tab yourself).
powershell -NoProfile -Command "foreach ($port in 4000,4100,4300,3000) { Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Stopping port ' + $port + ' pid ' + $_.OwningProcess); Stop-Process -Id $_.OwningProcess -Force } }"
