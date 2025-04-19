#!/bin/bash
set -e

echo "🚀 EZChat Local Network Runner 🚀"
echo "==============================="
echo "ℹ️  Ensure frontend/.env.local has the correct backend IP address."
echo ""

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check for required dependencies
check_dependencies() {
  echo "Checking dependencies..."

  # Check for Node.js and npm
  if ! command_exists node || ! command_exists npm || ! command_exists npx; then
    echo "❌ Node.js, npm, and npx are required. Please install Node.js."
    exit 1
  fi
  echo "✅ Found Node.js/npm/npx."

  # Find Python 3
  PYTHON_CMD=""
  for cmd in python3 python; do
    if command_exists $cmd && $cmd -c 'import sys; exit(0 if sys.version_info.major == 3 else 1)'; then
      PYTHON_CMD=$cmd
      PYTHON_VERSION=$($cmd --version)
      echo "✅ Found Python 3: $PYTHON_VERSION (using '$cmd')"
      break
    fi
  done

  if [ -z "$PYTHON_CMD" ]; then
    echo "❌ Python 3 is not installed. Please install Python 3."
    exit 1
  fi

  # Check for pip
  PIP_CMD=""
   # Try pip associated with the found Python command first
  PIP_CANDIDATE="${PYTHON_CMD/python/pip}"
  if command_exists "$PIP_CANDIDATE"; then
       PIP_CMD="$PIP_CANDIDATE"
  else
      # Fallback to common pip commands
      for cmd in pip3 pip; do
          if command_exists $cmd; then
              PIP_CMD=$cmd
              break
          fi
      done
  fi

  if [ -z "$PIP_CMD" ]; then
    echo "❌ pip/pip3 is not installed. Please install pip for Python 3."
    exit 1
  fi
  echo "✅ Found pip: $($PIP_CMD --version) (using '$PIP_CMD')"

  echo "✅ Core dependencies are installed."
}

# Check if backend virtual environment exists and has dependencies
check_backend_venv() {
  echo "Checking backend environment..."
  if [ ! -d "backend" ]; then
    echo "❌ Backend directory not found. Run this script from the project root."
    exit 1
  fi
  cd backend

  # Determine venv directory (.venv or venv)
  VENV_DIR=""
  if [ -d "../.venv" ]; then
    VENV_DIR="../.venv"
  elif [ -d "../venv" ]; then
     VENV_DIR="../venv"
  else
    echo "❌ Python virtual environment (.venv or venv) not found in project root."
    echo "Please set up the backend environment first:"
    echo "cd backend && python3 -m venv ../venv && source ../venv/bin/activate && pip install -r requirements.txt && deactivate && cd .."
    exit 1
  fi
  echo "✅ Found virtual environment: $VENV_DIR"

  # Basic check if requirements might be installed (uvicorn executable exists)
  if [ ! -f "$VENV_DIR/bin/uvicorn" ]; then
      echo "⚠️ Warning: Backend dependencies might not be installed in $VENV_DIR."
      echo "   If the backend fails, run: source $VENV_DIR/bin/activate && pip install -r requirements.txt && deactivate"
  fi

  cd ..
}

# Check if frontend dependencies are installed
check_frontend_deps() {
  echo "Checking frontend dependencies..."
   if [ ! -d "frontend" ]; then
    echo "❌ Frontend directory not found. Run this script from the project root."
    exit 1
  fi
  cd frontend

  if [ ! -d "node_modules" ]; then
    echo "❌ Frontend dependencies (node_modules) not installed."
    echo "Please install them manually: cd frontend && npm install && cd .."
    exit 1
  fi

  # Check if vite exists in node_modules/.bin
  if [ ! -f "node_modules/.bin/vite" ]; then
     echo "⚠️ Warning: 'vite' command not found in node_modules/.bin."
     echo "   Ensure 'vite' is listed in your frontend/package.json dependencies."
  fi

  echo "✅ Frontend dependencies appear to be installed."
  cd ..
}

# Run the backend server
run_backend() {
  echo "Starting backend server (listening on 0.0.0.0)..."
  cd backend

  # Determine venv directory
  if [ -d "../.venv" ]; then
    VENV_DIR="../.venv"
  else
    VENV_DIR="../venv" # Assume venv if .venv doesn't exist (checked earlier)
  fi

  # Activate and run
  source "$VENV_DIR/bin/activate"
  python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
  BACKEND_PID=$!
  deactivate # Deactivate immediately after starting background process
  cd ..
  echo "✅ Backend server starting in background (PID: $BACKEND_PID) on port 8000."
}

# Run the frontend development server
run_frontend() {
  echo "Starting frontend development server (listening on 0.0.0.0)..."
  cd frontend

  # Use npx to run the local vite installation
  npx vite --host &
  FRONTEND_PID=$!
  cd ..
  echo "✅ Frontend server starting in background (PID: $FRONTEND_PID). Check terminal for URL (usually port 1420 or 5173)."
}

# Clean up background processes on exit
cleanup() {
  echo "" # Newline before cleanup messages
  echo "🧹 Cleaning up background processes..."
  # Kill child processes gracefully, then forcefully if needed
  if [ ! -z "$BACKEND_PID" ]; then
    kill $BACKEND_PID 2>/dev/null || true
  fi
  if [ ! -z "$FRONTEND_PID" ]; then
    kill $FRONTEND_PID 2>/dev/null || true
  fi
  # Allow a moment for processes to terminate
  sleep 1
  # Force kill if they are still running (optional, can be aggressive)
  # if ps -p $BACKEND_PID > /dev/null; then kill -9 $BACKEND_PID 2>/dev/null; fi
  # if ps -p $FRONTEND_PID > /dev/null; then kill -9 $FRONTEND_PID 2>/dev/null; fi
  echo "✅ Cleanup complete."
}

# Register the cleanup function for SIGINT (Ctrl+C) and EXIT
trap cleanup SIGINT EXIT

# --- Main Execution ---
check_dependencies
check_backend_venv
check_frontend_deps

echo ""
echo "--- Starting Servers ---"
run_backend
sleep 2 # Give backend a moment to start before frontend
run_frontend

echo ""
echo "🎉 Both servers are starting up!"
echo "Backend should be available at http://<YOUR_IP>:8000"
echo "Frontend should be available at http://<YOUR_IP>:<FRONTEND_PORT> (Check Vite output for port)"
echo "Press Ctrl+C to stop both servers."
echo ""

# Keep the script running until Ctrl+C is pressed
wait 