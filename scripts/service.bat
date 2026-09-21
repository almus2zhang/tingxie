@echo off
setlocal enabledelayedexpansion
cd /d "c:\project\tingxie"

if "%1"=="" goto help
if "%1"=="start" goto start
if "%1"=="stop" goto stop
if "%1"=="restart" goto restart
if "%1"=="status" goto status
if "%1"=="install" goto install
if "%1"=="uninstall" goto uninstall
goto help

:status
set PID=
for /f "tokens=5" %%i in ('netstat -ano ^| findstr /r ":1234 .*LISTENING"') do (
    set PID=%%i
)
if defined PID (
    echo [RUNNING] Tingxie service is running on port 1234 (PID: !PID!).
) else (
    echo [STOPPED] Tingxie service is NOT running.
)
goto end

:start
set PID=
for /f "tokens=5" %%i in ('netstat -ano ^| findstr /r ":1234 .*LISTENING"') do (
    set PID=%%i
)
if defined PID (
    echo [ALREADY RUNNING] Tingxie service is already running on port 1234 (PID: !PID!).
    goto end
)
echo Starting Tingxie service in background...
start "" wscript.exe "c:\project\tingxie\scripts\start_silent.vbs"
timeout /t 2 /nobreak >nul
goto status

:stop
echo Stopping Tingxie service on port 1234...
for /f "tokens=5" %%i in ('netstat -ano ^| findstr /r ":1234 .*LISTENING"') do (
    taskkill /F /PID %%i >nul 2>&1
    echo Killed process PID %%i.
)
echo Done.
goto end

:restart
call :stop
timeout /t 1 /nobreak >nul
call :start
goto end

:install
echo Registering Tingxie startup autorun in HKCU registry...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "TingxieApp" /t REG_SZ /d "wscript.exe \"c:\project\tingxie\scripts\start_silent.vbs\"" /f
echo Creating shortcut in Startup folder...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut(\"$([System.Environment]::GetFolderPath('Startup'))\TingxieApp.lnk\"); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"c:\project\tingxie\scripts\start_silent.vbs\"'; $s.WorkingDirectory = 'c:\project\tingxie'; $s.Save()"
echo [SUCCESS] Auto-start configured for user logon!
goto end

:uninstall
echo Removing Tingxie startup autorun from HKCU registry...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "TingxieApp" /f >nul 2>&1
powershell -NoProfile -Command "Remove-Item \"$([System.Environment]::GetFolderPath('Startup'))\TingxieApp.lnk\" -ErrorAction SilentlyContinue"
echo [SUCCESS] Auto-start uninstalled.
goto end

:help
echo Usage: %0 {start^|stop^|restart^|status^|install^|uninstall}
goto end

:end
endlocal
