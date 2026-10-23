@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required. Reinstall Node.js with npm, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

powershell -NoProfile -Command "try { $null = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 2; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "SahayakAI Server" /D "%~dp0" cmd /k "npm start"
)

powershell -NoProfile -Command "$ready = $false; for ($i = 0; $i -lt 30; $i++) { try { $null = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 2; $ready = $true; break } catch { Start-Sleep -Seconds 1 } }; if ($ready) { Start-Process 'http://localhost:3000' } else { Write-Error 'SahayakAI did not start. Check the server window for errors.'; exit 1 }"
if errorlevel 1 (
  pause
  exit /b 1
)
