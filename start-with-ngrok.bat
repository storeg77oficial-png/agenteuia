@echo off
echo ========================================
echo   STORE SG CRM - Iniciando con Ngrok
echo ========================================
echo.

echo [1/3] Iniciando Ngrok...
start /B ngrok http 3000
timeout /t 5 /nobreak >nul

echo.
echo [2/3] Obteniendo URL de Ngrok...
for /f "tokens=*" %%a in ('curl -s http://127.0.0.1:4040/api/tunnels ^| findstr "public_url"') do set NGROK_URL=%%a
echo URL de Ngrok: %NGROK_URL%

echo.
echo [3/3] Iniciando servidor...
cd /d "%~dp0backend"
start /B node src/server.js
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo   SISTEMA INICIADO CORRECTAMENTE
echo ========================================
echo.
echo   Dashboard: http://localhost:3000
echo   Webhook URL: %NGROK_URL%/webhook
echo.
echo   Configura esta URL en Meta Developers:
echo   %NGROK_URL%/webhook
echo.
echo   Presiona Ctrl+C para detener
echo ========================================
echo.

REM Open dashboard
start http://localhost:3000

REM Keep running
pause