@echo off
chcp 65001 >nul
title Consolidado gerencial (teste local)
cd /d "%~dp0"
rem Uso local, so neste computador.
start "" http://localhost:3011/
python app.py
if errorlevel 1 (
  echo.
  echo O consolidado foi encerrado com erro. Veja a mensagem acima.
  pause
)
