@echo off
REM One-click launcher for Windows: double-click this file to start Galleria.
REM It opens your browser automatically once the app is ready.
cd /d "%~dp0"
call npm start
