@echo off
echo ========================================
echo   STORE SG CRM - Iniciando Sistema
echo ========================================
echo.

echo [1/4] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado
    pause
    exit /b 1
)
echo ✅ Node.js encontrado

echo.
echo [2/4] Instalando dependencias...
cd /d "%~dp0backend"
call npm install --silent
if errorlevel 1 (
    echo ERROR: Fallo al instalar dependencias
    pause
    exit /b 1
)
echo ✅ Dependencias instaladas

echo.
echo [3/4] Iniciando servidor...
start /B node src/server.js
timeout /t 3 /nobreak >nul

echo.
echo [4/4] Verificando servidor...
curl -s http://localhost:3000/health >nul 2>&1
if errorlevel 1 (
    echo ERROR: El servidor no inicio correctamente
    pause
    exit /b 1
)
echo ✅ Servidor iniciado en puerto 3000

echo.
echo ========================================
echo   SISTEMA INICIADO CORRECTAMENTE
echo ========================================
echo.
echo   Dashboard: http://localhost:3000
echo   API: http://localhost:3000/api/crm
echo   Webhook: http://localhost:3000/webhook
echo.
echo   Presiona Ctrl+C para detener el servidor
echo ========================================
echo.

REM Open dashboard in browser
start http://localhost:3000

REM Keep server running
node src/server.js