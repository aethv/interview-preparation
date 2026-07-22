@echo off
title InterviewLab
REM Move to the project root (this file lives in the "windows" subfolder)
cd /d "%~dp0.."

echo.
echo  ========================================
echo   InterviewLab - AI Technical Interviews
echo  ========================================
echo.

REM ---------------------------------------------------------------
REM  1. Check Docker Desktop is installed
REM     (backend database, cache, voice agent, and the code
REM      sandbox all run inside Docker)
REM ---------------------------------------------------------------
where docker >nul 2>&1
if errorlevel 1 (
  echo  Docker Desktop is not installed.
  echo.
  echo  We will open the download page in your browser.
  echo.
  echo  On that page:
  echo    1. Download "Docker Desktop for Windows"
  echo    2. Run the installer ^(keep all default options^)
  echo    3. Restart your computer when finished
  echo    4. Open "Docker Desktop" once and wait until it says "Running"
  echo    5. Double-click this file again
  echo.
  pause
  start "" "https://www.docker.com/products/docker-desktop/"
  echo.
  echo  Install Docker Desktop, restart your PC, then run this file again.
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------
REM  2. Check Docker Desktop is actually RUNNING
REM ---------------------------------------------------------------
docker info >nul 2>&1
if errorlevel 1 (
  echo  Docker Desktop is installed but not running yet.
  echo.
  echo  Please:
  echo    1. Open "Docker Desktop" from the Start menu
  echo    2. Wait until the whale icon says "Running"
  echo    3. Double-click this file again
  echo.
  pause
  start "" "docker desktop"
  exit /b 1
)

echo  Docker is ready.
echo.

REM ---------------------------------------------------------------
REM  3. Check Node.js is installed (needed for the website)
REM ---------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo  Node.js is not installed.
  echo.
  echo  We will open the download page in your browser.
  echo.
  echo  On that page:
  echo    1. Click the green LTS button
  echo    2. Run the installer ^(keep all default options^)
  echo    3. Restart your computer when finished
  echo    4. Double-click this file again
  echo.
  pause
  start "" "https://nodejs.org/en/download"
  echo.
  echo  Install Node.js, restart your PC, then run this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo  Node.js was found but npm is missing.
  echo  Please reinstall Node.js from the page we are opening.
  echo.
  pause
  start "" "https://nodejs.org/en/download"
  exit /b 1
)

echo  Node.js and npm are ready.
echo.

REM ---------------------------------------------------------------
REM  4. First-time: API keys (root .env)
REM ---------------------------------------------------------------
if not exist ".env" (
  copy .env.example .env >nul
  echo  API keys needed.
  echo.
  echo  Notepad will open a file called ".env".
  echo  Paste your keys after each = sign, for example:
  echo.
  echo    OPENAI_API_KEY=sk-your-key-here
  echo    ELEVENLABS_API_KEY=your-elevenlabs-key
  echo    LIVEKIT_API_KEY=your-livekit-key
  echo    LIVEKIT_API_SECRET=your-livekit-secret
  echo    LIVEKIT_URL=wss://your-instance.livekit.cloud
  echo    LIVEKIT_WS_URL=wss://your-instance.livekit.cloud
  echo.
  echo  Where to get keys:
  echo    OpenAI     - https://platform.openai.com/api-keys
  echo    ElevenLabs - https://elevenlabs.io/app/settings/api-keys
  echo    LiveKit    - https://cloud.livekit.io  ^(Settings ^> Keys^)
  echo.
  echo  Save the file ^(Ctrl+S^) and close Notepad when done.
  echo.
  pause
  notepad .env
  echo.
)

REM ---------------------------------------------------------------
REM  5. First-time: frontend web address (frontend\.env.local)
REM ---------------------------------------------------------------
if not exist "frontend\.env.local" (
  echo NEXT_PUBLIC_API_URL=http://localhost:8003> "frontend\.env.local"
)

REM ---------------------------------------------------------------
REM  6. Start the backend (database, cache, API, voice agent)
REM     First run builds the images and can take several minutes.
REM ---------------------------------------------------------------
echo  Starting the backend services in Docker...
echo  ^(The first run downloads and builds images - please be patient.^)
echo.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo  The backend failed to start.
  echo  Make sure Docker Desktop says "Running", then try again.
  echo.
  pause
  exit /b 1
)

echo.
echo  Backend is starting. Giving it a few seconds to warm up...
timeout /t 8 /nobreak >nul
echo.

REM ---------------------------------------------------------------
REM  7. First-time: install the website's parts
REM ---------------------------------------------------------------
if not exist "frontend\node_modules\" (
  echo  First run - installing the website ^(this can take a few minutes^)...
  pushd frontend
  call npm install
  if errorlevel 1 (
    echo.
    echo  Website install failed. Check your internet connection and try again.
    popd
    pause
    exit /b 1
  )
  popd
  echo.
)

REM ---------------------------------------------------------------
REM  8. First-time (or after an update): build the production site
REM     "next build" writes .next\BUILD_ID only on success, so its
REM     presence tells us a usable production build already exists.
REM     To force a rebuild after code changes, delete frontend\.next
REM ---------------------------------------------------------------
if not exist "frontend\.next\BUILD_ID" (
  echo  Building the website ^(first run - this can take a few minutes^)...
  pushd frontend
  call npm run build
  if errorlevel 1 (
    echo.
    echo  Build failed. Please contact whoever gave you this app.
    popd
    pause
    exit /b 1
  )
  popd
  echo.
)

REM ---------------------------------------------------------------
REM  9. Open the browser and serve the production build
REM     (this keeps running in this window - that is normal)
REM ---------------------------------------------------------------
echo  Starting InterviewLab...
echo  Your browser will open automatically at http://localhost:3005
echo.
echo  Keep this window open while you use the app.
echo  To stop: close this window, then open Docker Desktop and
echo  press Stop on the "interview-preparation" containers.
echo.

start "" http://localhost:3005
pushd frontend
REM  "npm start" (next start) has no port set, so pass 3005 explicitly
REM  to match the browser URL and the frontend API config.
call npx next start -p 3005
popd

pause
