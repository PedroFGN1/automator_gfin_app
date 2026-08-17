@echo off
title Automator GEFIN - Inicializando...
color 0A

echo ========================================================
echo      ROBO DE AUTOMACAO FINANCEIRA - GEFIN
echo ========================================================
echo.

:: 1. Verifica se ja foi instalado antes
if exist "node_modules" (
    echo [OK] Dependencias ja instaladas.
    goto INICIAR
)

:: 2. Se nao existir node_modules, instala tudo
echo [AVISO] Primeira execucao detectada.
echo [INFO] Instalando dependencias e baixando o Navegador...
echo.
echo Isso pode levar alguns minutos dependendo da internet.
echo Por favor, aguarde...
echo.

call npm install
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERRO] Falha na instalacao. Verifique a internet ou proxy.
    pause
    exit
)

:INICIAR
echo.
echo [SUCESSO] Tudo pronto. Iniciando a interface...
echo.

:: 3. Inicia o Electron
call npm start