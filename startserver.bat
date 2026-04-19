@echo off

REM Get script directory
set BASE_DIR=%~dp0

REM Start backend
start "Backend Server" cmd /k "cd /d "%BASE_DIR%Backend" && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

REM Start frontend
start "Frontend Server" cmd /k "cd /d "%BASE_DIR%Frontend" && npm run dev"

exit