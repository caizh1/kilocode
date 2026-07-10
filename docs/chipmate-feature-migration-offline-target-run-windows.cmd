@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

if "%~1"=="" goto usage
if "%~1"=="/?" goto usage
if "%~1"=="-h" goto usage
if "%~1"=="--help" goto usage

set "DELIVERY_DIR=%~1"
set "EVIDENCE_DIR=%~2"

if "%EVIDENCE_DIR%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%chipmate-feature-migration-offline-target-run-windows.ps1" -DeliveryDir "%DELIVERY_DIR%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%chipmate-feature-migration-offline-target-run-windows.ps1" -DeliveryDir "%DELIVERY_DIR%" -EvidenceDir "%EVIDENCE_DIR%"
)

exit /b %ERRORLEVEL%

:usage
echo Usage:
echo   chipmate-feature-migration-offline-target-run-windows.cmd ^<delivery-dir^> [evidence-dir]
echo.
echo Runs package/delivery integrity checks on an offline Windows target.
echo This does not install VS Code and does not run runtime smoke S1-S16.
exit /b 2
