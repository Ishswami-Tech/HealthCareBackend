# Healthcare App Windows Backup Script
# This PowerShell script downloads backups from the server to a Windows PC

# Configuration
$ServerIP = "82.208.20.16"
$ServerUser = "root" # SSH username for your server
$PrivateKeyPath = "C:\Path\To\Your\private_key.ppk" # Path to your private key file
$RemoteBackupDir = "/var/www/healthcare/backend/backups"
$RemoteDBBackupDir = "/var/backups/postgres"
$LocalBackupDir = "C:\HealthcareBackups" # Local Windows backup location - change this if needed
$SSHTimeout = 30 # Seconds

# Create local backup directories
$LocalAppBackupDir = Join-Path -Path $LocalBackupDir -ChildPath "application"
$LocalDBBackupDir = Join-Path -Path $LocalBackupDir -ChildPath "database"
$LocalSystemReportDir = Join-Path -Path $LocalBackupDir -ChildPath "reports"

# Create directories if they don't exist
if (-not (Test-Path -Path $LocalBackupDir)) {
    New-Item -ItemType Directory -Path $LocalBackupDir -Force | Out-Null
    Write-Host "Created backup directory: $LocalBackupDir"
}

if (-not (Test-Path -Path $LocalAppBackupDir)) {
    New-Item -ItemType Directory -Path $LocalAppBackupDir -Force | Out-Null
}

if (-not (Test-Path -Path $LocalDBBackupDir)) {
    New-Item -ItemType Directory -Path $LocalDBBackupDir -Force | Out-Null
}

if (-not (Test-Path -Path $LocalSystemReportDir)) {
    New-Item -ItemType Directory -Path $LocalSystemReportDir -Force | Out-Null
}

# Check if PSCP is installed (part of PuTTY)
function Test-PSCPInstalled {
    try {
        $null = Get-Command -Name pscp -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

# Function to download a file from the server
function Download-FromServer {
    param (
        [string]$RemotePath,
        [string]$LocalPath
    )
    
    Write-Host "Downloading from $RemotePath to $LocalPath..."
    
    try {
        $pscp = "pscp"
        $args = "-i `"$PrivateKeyPath`" -r -P 22 -batch -q -T -l $ServerUser $ServerUser@$ServerIP`:$RemotePath `"$LocalPath`""
        
        $pInfo = New-Object System.Diagnostics.ProcessStartInfo
        $pInfo.FileName = $pscp
        $pInfo.Arguments = $args
        $pInfo.RedirectStandardError = $true
        $pInfo.RedirectStandardOutput = $true
        $pInfo.UseShellExecute = $false
        
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $pInfo
        $process.Start() | Out-Null
        
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        
        if (-not $process.WaitForExit($SSHTimeout * 1000)) {
            $process.Kill()
            Write-Host "ERROR: Connection timed out." -ForegroundColor Red
            return $false
        }
        
        if ($process.ExitCode -ne 0) {
            Write-Host "ERROR: Download failed with exit code $($process.ExitCode)" -ForegroundColor Red
            Write-Host "Error details: $stderr" -ForegroundColor Red
            return $false
        }
        
        Write-Host "Download completed successfully." -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "ERROR: Failed to download - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Function to create system report
function Create-SystemReport {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $reportFile = Join-Path -Path $LocalSystemReportDir -ChildPath "healthcare_backup_report_$timestamp.txt"
    
    Write-Host "Creating backup report at $reportFile..."
    
    try {
        $reportContent = @"
===== HEALTHCARE BACKUP REPORT =====
Date: $(Get-Date)
Windows Computer: $env:COMPUTERNAME
Backup Location: $LocalBackupDir

===== APPLICATION BACKUPS =====
$(
    $appBackups = Get-ChildItem -Path $LocalAppBackupDir -ErrorAction SilentlyContinue
    if ($appBackups) {
        $appBackups | Format-Table Name, LastWriteTime, Length -AutoSize | Out-String
    } else {
        "No application backups found."
    }
)

===== DATABASE BACKUPS =====
$(
    $dbBackups = Get-ChildItem -Path $LocalDBBackupDir -ErrorAction SilentlyContinue
    if ($dbBackups) {
        $dbBackups | Format-Table Name, LastWriteTime, Length -AutoSize | Out-String
    } else {
        "No database backups found."
    }
)

===== LATEST BACKUP SIZES =====
$(
    $latestAppBackup = Get-ChildItem -Path $LocalAppBackupDir -ErrorAction SilentlyContinue | 
                        Sort-Object LastWriteTime -Descending | 
                        Select-Object -First 1
    $latestDBBackup = Get-ChildItem -Path $LocalDBBackupDir -ErrorAction SilentlyContinue | 
                        Sort-Object LastWriteTime -Descending | 
                        Select-Object -First 1
    
    "Latest Application Backup: " + $(if ($latestAppBackup) { "$($latestAppBackup.Name) - $([math]::Round($latestAppBackup.Length / 1MB, 2)) MB" } else { "None" })
    "Latest Database Backup: " + $(if ($latestDBBackup) { "$($latestDBBackup.Name) - $([math]::Round($latestDBBackup.Length / 1MB, 2)) MB" } else { "None" })
)

===== BACKUP STORAGE =====
Available disk space: $([math]::Round((Get-PSDrive -Name ($LocalBackupDir.Substring(0, 1))).Free / 1GB, 2)) GB
"@

        $reportContent | Out-File -FilePath $reportFile -Encoding UTF8
        Write-Host "Backup report created successfully." -ForegroundColor Green
        return $reportFile
    }
    catch {
        Write-Host "ERROR: Failed to create backup report - $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# Main execution
Write-Host "====================== WINDOWS BACKUP PROCESS STARTED ======================" -ForegroundColor Cyan

# Check for PSCP
if (-not (Test-PSCPInstalled)) {
    Write-Host "ERROR: PSCP (PuTTY SCP) is not installed or not in your PATH." -ForegroundColor Red
    Write-Host "Please download and install PuTTY from https://www.putty.org/" -ForegroundColor Yellow
    exit 1
}

# Validate private key file
if (-not (Test-Path -Path $PrivateKeyPath)) {
    Write-Host "ERROR: Private key file not found at $PrivateKeyPath" -ForegroundColor Red
    exit 1
}

# Create timestamp for this backup operation
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Get latest application backup information
Write-Host "Retrieving latest backup information..." -ForegroundColor Cyan
$tempFile = [System.IO.Path]::GetTempFileName()
$success = Download-FromServer -RemotePath "$RemoteBackupDir/latest_backup" -LocalPath $tempFile

if ($success) {
    $latestBackup = Get-Content -Path $tempFile -Raw
    if ($latestBackup) {
        $latestBackup = $latestBackup.Trim()
        Write-Host "Latest application backup: $latestBackup" -ForegroundColor Green
        
        # Download the latest application backup
        $backupArchiveName = "healthcare_app_${latestBackup}_${timestamp}.tar.gz"
        $remoteCommand = "tar -czf /tmp/$backupArchiveName -C $RemoteBackupDir $latestBackup"
        
        # Create temp script to run on server
        $tempScriptFile = [System.IO.Path]::GetTempFileName()
        $remoteCommand | Out-File -FilePath $tempScriptFile -Encoding ASCII
        
        # Upload and execute the script
        $uploadScriptSuccess = Download-FromServer -RemotePath "/tmp/$backupArchiveName" -LocalPath (Join-Path -Path $LocalAppBackupDir -ChildPath $backupArchiveName)
        
        if ($uploadScriptSuccess) {
            Write-Host "Application backup downloaded successfully." -ForegroundColor Green
        }
        else {
            Write-Host "Failed to download application backup." -ForegroundColor Red
        }
    }
    else {
        Write-Host "No latest backup marker found on server." -ForegroundColor Yellow
    }
}
else {
    Write-Host "Failed to retrieve latest backup information." -ForegroundColor Red
}

# Download latest database backup
Write-Host "Downloading latest database backup..." -ForegroundColor Cyan
$remoteCommand = "find $RemoteDBBackupDir -type f -name '*.sql.gz' -o -name '*.dump' | sort -r | head -n 1"

# Create temp script to run on server
$tempScriptFile = [System.IO.Path]::GetTempFileName()
$remoteCommand | Out-File -FilePath $tempScriptFile -Encoding ASCII

# Upload and execute the script to find latest DB backup
$tempOutputFile = [System.IO.Path]::GetTempFileName()
$scriptSuccess = Download-FromServer -RemotePath "`$($remoteCommand)" -LocalPath $tempOutputFile

if ($scriptSuccess) {
    $latestDBBackupPath = Get-Content -Path $tempOutputFile -Raw
    if ($latestDBBackupPath) {
        $latestDBBackupPath = $latestDBBackupPath.Trim()
        $dbBackupFilename = Split-Path -Path $latestDBBackupPath -Leaf
        
        # Download the DB backup
        $dbBackupSuccess = Download-FromServer -RemotePath $latestDBBackupPath -LocalPath (Join-Path -Path $LocalDBBackupDir -ChildPath $dbBackupFilename)
        
        if ($dbBackupSuccess) {
            Write-Host "Database backup downloaded successfully." -ForegroundColor Green
        }
        else {
            Write-Host "Failed to download database backup." -ForegroundColor Red
        }
    }
    else {
        Write-Host "No database backups found on server." -ForegroundColor Yellow
    }
}
else {
    Write-Host "Failed to find latest database backup on server." -ForegroundColor Red
}

# Create local system report
$reportFile = Create-SystemReport
if ($reportFile) {
    Write-Host "Local backup report created at: $reportFile" -ForegroundColor Green
    # Open the report
    Start-Process $reportFile
}

# Cleanup
Remove-Item -Path $tempFile -ErrorAction SilentlyContinue
Remove-Item -Path $tempScriptFile -ErrorAction SilentlyContinue
Remove-Item -Path $tempOutputFile -ErrorAction SilentlyContinue

Write-Host "====================== WINDOWS BACKUP PROCESS COMPLETED ======================" -ForegroundColor Cyan 