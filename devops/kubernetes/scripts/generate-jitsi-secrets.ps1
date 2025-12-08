# PowerShell script to generate Jitsi Meet secrets for Kubernetes

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Join-Path (Split-Path -Parent $ScriptDir) "base"
$SecretsFile = Join-Path $BaseDir "secrets.yaml"

Write-Host "🔐 Generating Jitsi Meet secrets..." -ForegroundColor Cyan

# Check if secrets.yaml already exists
if (Test-Path $SecretsFile) {
    $response = Read-Host "⚠️  Warning: secrets.yaml already exists. Do you want to update Jitsi secrets? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "   Skipping secret generation." -ForegroundColor Yellow
        exit 0
    }
}

# Generate secure random passwords
Write-Host "   Generating secure random passwords..." -ForegroundColor Gray

function Get-RandomBase64 {
    param([int]$Length = 32)
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes)
}

$JicofoSecret = Get-RandomBase64 -Length 32
$FocusPassword = Get-RandomBase64 -Length 32
$JvbPassword = Get-RandomBase64 -Length 32
$JigasiPassword = Get-RandomBase64 -Length 32
$JibriRecorderPassword = Get-RandomBase64 -Length 32
$JibriXmppPassword = Get-RandomBase64 -Length 32
$JwtSecret = Get-RandomBase64 -Length 64

# Base64 encode them
$JicofoSecretB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($JicofoSecret))
$FocusPasswordB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($FocusPassword))
$JvbPasswordB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($JvbPassword))
$JigasiPasswordB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($JigasiPassword))
$JibriRecorderPasswordB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($JibriRecorderPassword))
$JibriXmppPasswordB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($JibriXmppPassword))
$JwtSecretB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($JwtSecret))

Write-Host "✅ Generated Jitsi secrets:" -ForegroundColor Green
Write-Host "   - Jicofo Secret: $($JicofoSecret.Substring(0, [Math]::Min(20, $JicofoSecret.Length)))..." -ForegroundColor Gray
Write-Host "   - Focus Password: $($FocusPassword.Substring(0, [Math]::Min(20, $FocusPassword.Length)))..." -ForegroundColor Gray
Write-Host "   - JVB Password: $($JvbPassword.Substring(0, [Math]::Min(20, $JvbPassword.Length)))..." -ForegroundColor Gray
Write-Host "   - JWT Secret: $($JwtSecret.Substring(0, [Math]::Min(20, $JwtSecret.Length)))..." -ForegroundColor Gray

# Create or update secrets.yaml
if (-not (Test-Path $SecretsFile)) {
    Write-Host "   Creating new secrets.yaml from template..." -ForegroundColor Gray
    $TemplateFile = Join-Path $BaseDir "secrets.yaml.template"
    Copy-Item $TemplateFile $SecretsFile
}

# Update Jitsi secrets in secrets.yaml
Write-Host "   Updating secrets.yaml with Jitsi secrets..." -ForegroundColor Gray

$content = Get-Content $SecretsFile -Raw
$content = $content -replace "jitsi-jicofo-secret: <BASE64_ENCODED_VALUE>", "jitsi-jicofo-secret: $JicofoSecretB64"
$content = $content -replace "jitsi-focus-password: <BASE64_ENCODED_VALUE>", "jitsi-focus-password: $FocusPasswordB64"
$content = $content -replace "jitsi-jvb-password: <BASE64_ENCODED_VALUE>", "jitsi-jvb-password: $JvbPasswordB64"
$content = $content -replace "jitsi-jigasi-password: <BASE64_ENCODED_VALUE>", "jitsi-jigasi-password: $JigasiPasswordB64"
$content = $content -replace "jitsi-jibri-recorder-password: <BASE64_ENCODED_VALUE>", "jitsi-jibri-recorder-password: $JibriRecorderPasswordB64"
$content = $content -replace "jitsi-jibri-xmpp-password: <BASE64_ENCODED_VALUE>", "jitsi-jibri-xmpp-password: $JibriXmppPasswordB64"
$content = $content -replace "jitsi-jwt-secret: <BASE64_ENCODED_VALUE>", "jitsi-jwt-secret: $JwtSecretB64"

Set-Content -Path $SecretsFile -Value $content -NoNewline

Write-Host "✅ Jitsi secrets updated in: $SecretsFile" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Review the secrets.yaml file"
Write-Host "   2. Apply secrets: kubectl apply -f $SecretsFile"
Write-Host "   3. Deploy Jitsi: kubectl apply -k $BaseDir"
Write-Host ""
Write-Host "⚠️  IMPORTANT: Keep secrets.yaml secure and do NOT commit it to version control!" -ForegroundColor Yellow
