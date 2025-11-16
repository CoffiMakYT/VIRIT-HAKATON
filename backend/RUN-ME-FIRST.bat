@echo off
chcp 65001 > nul
echo ========================================
echo    DREAM INTERPRETER - BACKEND
echo ========================================
echo.

echo Step 1: Checking Java...
java -version > nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Java 17 is not installed!
    echo.
    echo Download from: https://adoptium.net/temurin/releases/
    echo Choose: JDK 17, Windows x64
    echo.
    pause
    exit /b 1
)
echo ✓ Java is OK

echo.
echo Step 2: Starting application...
echo API: http://localhost:8080
echo.
echo Endpoints:
echo - POST /api/auth/login
echo - POST /api/chat/message  
echo - GET  /api/chat/limits
echo - POST /api/payment/create
echo.
echo Press Ctrl+C to stop
echo.

java -jar ai-dream-interpreter-0.0.1-SNAPSHOT.jar

pause