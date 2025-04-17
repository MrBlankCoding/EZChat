#!/bin/bash
set -e

echo "🚀 EZChat Build & Run Script 🚀"
echo "==============================="

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check for required dependencies
check_dependencies() {
  echo "Checking dependencies..."
  
  # Check for Node.js and npm
  if ! command_exists node; then
    echo "❌ Node.js is not installed. Please install Node.js."
    exit 1
  fi
  
  # Check for preferred Python versions first, then fall back to any Python 3
  PYTHON_CMD=""
  for cmd in python3.10 python3.11 python3.9 python3.8 python3; do
    if command_exists $cmd; then
      PYTHON_CMD=$cmd
      PYTHON_VERSION=$($cmd --version)
      echo "✅ Found Python: $PYTHON_VERSION"
      break
    fi
  done
  
  if [ -z "$PYTHON_CMD" ]; then
    echo "❌ Python3 is not installed. Please install Python3 (preferably version 3.9-3.11)."
    exit 1
  fi
  
  # Check for pip
  PIP_CMD=""
  for cmd in pip3.10 pip3.11 pip3.9 pip3.8 pip3; do
    if command_exists $cmd; then
      PIP_CMD=$cmd
      echo "✅ Found pip: $($cmd --version)"
      break
    fi
  done
  
  if [ -z "$PIP_CMD" ]; then
    echo "❌ pip3 is not installed. Please install pip3."
    exit 1
  fi
  
  # Check for Rust/Cargo (needed for Tauri)
  if ! command_exists cargo && [ "$FRONTEND_MODE" == "tauri" ]; then
    echo "❌ Rust is not installed. It's required for Tauri builds."
    echo "Please install Rust from https://rustup.rs/"
    exit 1
  elif ! command_exists cargo; then
    echo "⚠️  Rust is not installed. It won't be needed unless you run with --tauri."
  fi
  
  echo "✅ All major dependencies are installed."
}

# Check if backend virtual environment exists
check_backend_venv() {
  echo "Checking backend virtual environment..."
  cd backend
  
  # Check if either venv or .venv directory exists
  if [ ! -d "venv" ] && [ ! -d ".venv" ]; then
    echo "❌ Python virtual environment not found."
    echo "Please set up a virtual environment and install dependencies with:"
    echo "cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    cd ..
    exit 1
  fi
  
  # Determine which venv directory to use
  if [ -d "venv" ]; then
    VENV_DIR="venv"
  else
    VENV_DIR=".venv"
  fi
  
  echo "✅ Found virtual environment in: $VENV_DIR"
  cd ..
}

# Check if frontend dependencies are installed
check_frontend_deps() {
  echo "Checking frontend dependencies..."
  cd frontend
  
  if [ ! -d "node_modules" ]; then
    echo "❌ Frontend dependencies not installed."
    echo "Please install them manually with:"
    echo "cd frontend && npm install"
    cd ..
    exit 1
  fi
  
  echo "✅ Frontend dependencies appear to be installed."
  cd ..
}

# Run the backend server
run_backend() {
  echo "Starting backend server..."
  cd backend
  
  # Determine which venv directory to use
  if [ -d "venv" ]; then
    VENV_DIR="venv"
  else
    VENV_DIR=".venv"
  fi
  
  # Activate the virtual environment
  source $VENV_DIR/bin/activate
  
  # Run the FastAPI server with uvicorn
  python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
  BACKEND_PID=$!
  cd ..
  echo "✅ Backend server started at http://localhost:8000"
}

# Run the frontend development server
run_frontend() {
  echo "Starting frontend development server..."
  cd frontend
  
  if [ "$1" == "tauri" ]; then
    echo "Building and running Tauri app..."
    npm run tauri dev &
  else
    echo "Starting Vite dev server..."
    npm run dev &
  fi
  
  FRONTEND_PID=$!
  cd ..
  echo "✅ Frontend started"
}

# Clean up background processes on exit
cleanup() {
  echo "Cleaning up..."
  if [ ! -z "$BACKEND_PID" ]; then
    kill $BACKEND_PID 2>/dev/null || true
  fi
  if [ ! -z "$FRONTEND_PID" ]; then
    kill $FRONTEND_PID 2>/dev/null || true
  fi
  echo "Done."
}

# Register the cleanup function for when the script exits
trap cleanup EXIT

# Parse command line arguments
FRONTEND_MODE="web"

for arg in "$@"; do
  case $arg in
    --tauri)
      FRONTEND_MODE="tauri"
      ;;
  esac
done

# Main execution
check_dependencies
check_backend_venv
check_frontend_deps
run_backend
run_frontend $FRONTEND_MODE

echo "🎉 EZChat is now running!"
echo "Backend API: http://localhost:8000/api"
echo "Backend WebSocket: ws://localhost:8000/ws"
if [ "$FRONTEND_MODE" == "web" ]; then
  echo "Frontend: Check the Vite output for URL (typically http://localhost:1420)"
else
  echo "Tauri app is starting..."
fi

echo "Press Ctrl+C to stop all servers."

# Keep the script running
wait 