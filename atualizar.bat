@echo off
chcp 65001 > nul
title Automator GEFIN - Atualizando Repositorio...
color 0B

echo ========================================================
echo      ATUALIZACAO DO SISTEMA - GEFIN (GIT PULL)
echo ========================================================
echo.

:: 1. Verifica se o Git esta instalado
where git >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERRO] O Git nao foi encontrado no PATH do sistema.
    echo Por favor, instale o Git ou verifique as variaveis de ambiente.
    echo.
    pause
    exit /b 1
)

:: 2. Obtem a branch atual dinamicamente
for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set CURRENT_BRANCH=%%i

if "%CURRENT_BRANCH%"=="" (
    color 0C
    echo [ERRO] Nao foi possivel identificar a branch atual do repositorio Git.
    echo.
    pause
    exit /b 1
)

echo [INFO] Branch atual detectada: %CURRENT_BRANCH%
echo [INFO] Buscando atualizacoes no repositorio remoto (origin)...
echo.

:: 3. Busca todas as atualizacoes remotas da branch atual
git fetch origin %CURRENT_BRANCH%
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERRO] Falha ao conectar ao repositorio remoto. Verifique sua conexao com a internet.
    echo.
    pause
    exit /b 1
)

:: 4. Forca a sobrescrita das alteracoes locais pelas remotas (prevalecendo o remoto)
echo [INFO] Aplicando alteracoes remotas e sobrescrevendo divergencias locais...
git reset --hard origin/%CURRENT_BRANCH%
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERRO] Falha ao sincronizar com a branch remota origin/%CURRENT_BRANCH%.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo [SUCESSO] Repositorio atualizado com sucesso!
echo Todas as alteracoes de origin/%CURRENT_BRANCH% foram aplicadas.
echo ========================================================
echo.
pause
