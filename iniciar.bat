@echo off
cd /d %~dp0

start "Servidor" cmd /k "npm run dev"
timeout /t 5 >nul
start "Ngrok" cmd /k "npx ngrok http 3000"

timeout /t 5 >nul
start http://localhost:3000