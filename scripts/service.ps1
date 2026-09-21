param (
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "restart", "status", "install", "uninstall")]
    [string]$Action = "status"
)

$RootDir = "c:\project\tingxie"
$VbsPath = "$RootDir\scripts\start_silent.vbs"
$StartupFolder = [System.Environment]::GetFolderPath('Startup')
$ShortcutPath = "$StartupFolder\TingxieApp.lnk"
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegName = "TingxieApp"

function Get-TingxiePid {
    $conn = Get-NetTCPConnection -LocalPort 1234 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        return $conn.OwningProcess
    }
    return $null
}

switch ($Action) {
    "status" {
        $procId = Get-TingxiePid
        if ($procId) {
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            Write-Host "[RUNNING] Tingxie service is running on http://localhost:1234 (PID: $procId, Name: $($p.Name))" -ForegroundColor Green
        } else {
            Write-Host "[STOPPED] Tingxie service is NOT running on port 1234." -ForegroundColor Yellow
        }
    }
    "start" {
        $procId = Get-TingxiePid
        if ($procId) {
            Write-Host "[ALREADY RUNNING] Tingxie service is already running on port 1234 (PID: $procId)." -ForegroundColor Cyan
            return
        }
        Write-Host "Starting Tingxie service in background..." -ForegroundColor Cyan
        Start-Process -FilePath "wscript.exe" -ArgumentList "`"$VbsPath`"" -WorkingDirectory $RootDir
        Start-Sleep -Seconds 2
        $procId = Get-TingxiePid
        if ($procId) {
            Write-Host "[SUCCESS] Tingxie service started successfully on http://localhost:1234 (PID: $procId)." -ForegroundColor Green
        } else {
            Write-Host "[WARNING] Service initiated, checking log at $RootDir\tingxie.log..." -ForegroundColor Yellow
        }
    }
    "stop" {
        $procId = Get-TingxiePid
        if ($procId) {
            Write-Host "Stopping Tingxie service (PID: $procId)..." -ForegroundColor Yellow
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            Write-Host "[STOPPED] Process terminated." -ForegroundColor Green
        } else {
            Write-Host "[STOPPED] Tingxie service is not running." -ForegroundColor Gray
        }
    }
    "restart" {
        Write-Host "Restarting Tingxie service..." -ForegroundColor Cyan
        & $MyInvocation.MyCommand.Path -Action stop
        Start-Sleep -Seconds 1
        & $MyInvocation.MyCommand.Path -Action start
    }
    "install" {
        Write-Host "Installing Tingxie to autorun on user login..." -ForegroundColor Cyan
        
        # 1. Registry Run key
        Set-ItemProperty -Path $RegPath -Name $RegName -Value "wscript.exe `"$VbsPath`"" -Force
        
        # 2. Startup folder shortcut
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
        $Shortcut.TargetPath = "wscript.exe"
        $Shortcut.Arguments = "`"$VbsPath`""
        $Shortcut.WorkingDirectory = $RootDir
        $Shortcut.Description = "Tingxie Auto-Start Background Service"
        $Shortcut.Save()
        
        Write-Host "[SUCCESS] Tingxie autorun successfully configured in Registry and Startup Menu!" -ForegroundColor Green
        Write-Host "Service will automatically launch in the background whenever you log into Windows." -ForegroundColor Green
    }
    "uninstall" {
        Write-Host "Removing Tingxie autorun configuration..." -ForegroundColor Yellow
        Remove-ItemProperty -Path $RegPath -Name $RegName -ErrorAction SilentlyContinue
        if (Test-Path $ShortcutPath) {
            Remove-Item $ShortcutPath -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[SUCCESS] Tingxie autorun removed from startup." -ForegroundColor Green
    }
}
