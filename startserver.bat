@echo off

REM Start backend (FastAPI with uvicorn)
start "Backend Server" cmd /k "cd /d D:\Weekly_Report\Backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

REM Start frontend (npm dev server)
start "Frontend Server" cmd /k "cd /d D:\Weekly_Report\Frontend && npm run dev"

exit