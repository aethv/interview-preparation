InterviewLab - Windows quick start
===================================

FOR NON-TECHNICAL USERS
-----------------------

Double-click:  Start-Interview.bat

The first time:
  - If Docker Desktop is missing, your browser opens the download page
    Install it (default options), restart your PC, then OPEN Docker
    Desktop once and wait until it says "Running"
  - If Node.js is missing, your browser opens the download page
    Install it (green LTS button, default options), restart your PC
  - Notepad opens so you can paste your API keys (OpenAI, ElevenLabs,
    LiveKit). Paste each key after the = sign, save (Ctrl+S), and close
  - The backend builds and starts inside Docker (can take several minutes)
  - The website installs its parts, then builds for production
    (can take a few minutes)
  - Your browser opens the app automatically

Every time after that:
  - Make sure Docker Desktop is open and says "Running"
  - Double-click Start-Interview.bat
  - Your browser opens the app automatically
  - Keep the black window open while using InterviewLab
  - When done: close the window, then open Docker Desktop and press
    Stop on the "interview-preparation" containers

WHAT YOU NEED (first run only)
------------------------------
  - Docker Desktop   https://www.docker.com/products/docker-desktop/
  - Node.js (LTS)    https://nodejs.org/en/download
  - API keys:
      OpenAI      https://platform.openai.com/api-keys
      ElevenLabs  https://elevenlabs.io/app/settings/api-keys
      LiveKit     https://cloud.livekit.io  (Settings > Keys)

TIPS
----
- Right-click "Start-Interview.bat" > Send to > Desktop to make a shortcut
- The website runs at http://localhost:3005 in your browser
- The backend (API) runs at http://localhost:8003
- Docker Desktop must be running BEFORE you start the app each time
- Your keys are saved in the ".env" file in the main project folder;
  you only enter them once
- The website runs as a production build. It builds once on first run;
  after updating the code, delete the "frontend\.next" folder to force
  a fresh build on the next start

NEED HELP?
----------
Ask a colleague or IT to help with the first run - especially installing
Docker Desktop and getting the three sets of API keys.
