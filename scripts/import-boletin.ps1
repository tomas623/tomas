# scripts/import-boletin.ps1
#
# Wrapper PowerShell para Windows Task Scheduler.
# Activa el venv si existe, ejecuta el script Python y captura el código de salida.
# El logging detallado lo hace el .py — esta capa solo se ocupa del entorno.
#
# Uso manual desde PowerShell:
#   .\scripts\import-boletin.ps1
#   .\scripts\import-boletin.ps1 -ForceFrom 6000
#   .\scripts\import-boletin.ps1 -DryRun

param(
    [int]$ForceFrom = 0,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Ubicación del repo: el script vive en <repo>/scripts/, así que el repo es ..
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# Cargar variables de .env si existe (Task Scheduler corre sin shell profile)
$EnvFile = Join-Path $RepoRoot ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $kv = $line -split "=", 2
            if ($kv.Count -eq 2) {
                $name = $kv[0].Trim()
                $value = $kv[1].Trim().Trim('"').Trim("'")
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
    }
}

# Activar venv si existe
$Python = "python"
$Venv = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (Test-Path $Venv) {
    $Python = $Venv
}

# Argumentos para el script Python
$Args = @("scripts\import-boletin.py")
if ($ForceFrom -gt 0) { $Args += @("--force-from", $ForceFrom) }
if ($DryRun) { $Args += "--dry-run" }

Write-Host "Ejecutando: $Python $($Args -join ' ')"
Write-Host "Repo: $RepoRoot"

& $Python @Args
$ExitCode = $LASTEXITCODE

if ($ExitCode -ne 0) {
    Write-Host "Importador terminó con error (exit $ExitCode). Revisar logs\import-boletin-*.log" -ForegroundColor Red
} else {
    Write-Host "Importador finalizó OK." -ForegroundColor Green
}

exit $ExitCode
