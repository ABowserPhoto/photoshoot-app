@echo off
setlocal

echo ============================================
echo Studio App Deployment with PM2 (Windows)
echo ============================================
echo.

echo [1/5] Installing PM2 globally...
npm install -g pm2
if errorlevel 1 (
  echo ERROR: Failed to install PM2.
  pause
  exit /b 1
)
echo PM2 installed.
echo.

echo [2/5] Starting Next.js app with PM2 as "studio-app"...
pm2 start npm --name "studio-app" -- start
if errorlevel 1 (
  echo ERROR: Failed to start app with PM2.
  pause
  exit /b 1
)
echo App started with PM2.
echo.

echo [3/5] Installing pm2-windows-startup globally...
npm install -g pm2-windows-startup
if errorlevel 1 (
  echo ERROR: Failed to install pm2-windows-startup.
  pause
  exit /b 1
)
echo pm2-windows-startup installed.
echo.

echo [4/5] Configuring PM2 to start on Windows boot...
pm2-startup install
if errorlevel 1 (
  echo ERROR: Failed to configure PM2 startup.
  pause
  exit /b 1
)
echo PM2 startup configured.
echo.

echo [5/5] Saving PM2 process list...
pm2 save
if errorlevel 1 (
  echo ERROR: Failed to save PM2 process list.
  pause
  exit /b 1
)
echo PM2 process list saved successfully.
echo.

echo ============================================
echo Done! "studio-app" is configured for reboot.
echo ============================================
echo.
echo You can verify with: pm2 list
echo.
pause

