# scripts/install-task-scheduler.ps1
#
# Registra la tarea programada de Windows que corre el importador semanal.
#
# El INPI publica boletines los miércoles. Esta tarea corre los miércoles a las
# 21:00 hora local (después de la publicación habitual del PDF), y reintenta
# automáticamente si falla.
#
# Uso (ejecutar UNA vez como Administrador desde PowerShell):
#   .\scripts\install-task-scheduler.ps1
#
# Para desinstalar:
#   Unregister-ScheduledTask -TaskName "LegalPacers-Import-Boletin" -Confirm:$false

#Requires -RunAsAdministrator

param(
    [string]$TaskName = "LegalPacers-Import-Boletin",
    [string]$RunTime = "21:00",
    [string]$DayOfWeek = "Wednesday"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Wrapper = Join-Path $RepoRoot "scripts\import-boletin.ps1"

if (-not (Test-Path $Wrapper)) {
    Write-Error "No encuentro $Wrapper — asegurate de correr este script desde dentro del repo."
    exit 1
}

# La acción: PowerShell ejecuta el wrapper sin profile y bypaseando políticas
$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`"" `
    -WorkingDirectory $RepoRoot

# Trigger: semanal, miércoles a la hora indicada
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $RunTime

# Setup: si la PC estaba apagada, correr la tarea apenas se prenda; reintentar 3 veces
# con espera de 30 minutos si falla la red (boletín aún no publicado, etc.)
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 30) `
    -AllowStartIfOnBatteries

# Identidad: usar la cuenta del usuario actual con sus permisos elevados
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Highest

# Si ya existe, removerla primero
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
    Write-Host "Removiendo tarea existente '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description "LegalPacers — Importa los boletines INPI cada miércoles ($RunTime)" `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal | Out-Null

Write-Host ""
Write-Host "Tarea programada creada:" -ForegroundColor Green
Write-Host "  Nombre:  $TaskName"
Write-Host "  Cuándo:  cada $DayOfWeek a las $RunTime"
Write-Host "  Script:  $Wrapper"
Write-Host ""
Write-Host "Para correrla manualmente ahora:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "Para verla:"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'"
