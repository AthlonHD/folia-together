@echo off
rem scripts/stop-stage.cmd
rem Stops the services started by start-stage.cmd by killing whatever listens on
rem ports 4000 / 4100 / 4300 / 4400 / 3000, but ONLY if that process is node.exe - other programs that happen to
rem use one of these ports (desktop QQ listens on random local ports around 4001/4301) are never touched.
rem Browsers are left alone (close the Host Chrome tab yourself).
powershell -NoProfile -Command "foreach ($port in 4000,4100,4300,4400,3000) { Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Write-Host ('Stopping port ' + $port + ' pid ' + $_.OwningProcess); Stop-Process -Id $_.OwningProcess -Force } else { Write-Host ('Port ' + $port + ' is used by a non-node process, left alone') } } }"
