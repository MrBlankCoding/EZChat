# EZChat Build Instructions

This document provides detailed instructions for building and running the EZChat application using the provided build script.

## Build Script Overview

The `build.sh` script automates the process of running both the backend and frontend components of EZChat. It handles:

1. Dependency checking
2. Verifying that a Python virtual environment exists
3. Verifying that frontend node_modules exist
4. Starting the backend server
5. Starting either the web or Tauri desktop frontend
6. Graceful shutdown of all components

## System Requirements

- **Node.js**: v14+ recommended
- **Python**: v3.8-3.11 recommended (Python 3.13 may have compatibility issues with some packages)
- **Rust**: Latest stable version (only needed for Tauri desktop builds)

## Prerequisites

**Important:** The build script does NOT create a virtual environment or install dependencies automatically. You must set these up manually before running the script:

### Backend Setup

```bash
cd backend
python3 -m venv venv  # Use python3.10 or python3.11 for best compatibility
source venv/bin/activate
pip install -r requirements.txt
```

Note: The script will recognize either a `venv` or `.venv` directory in the backend folder.

### Frontend Setup

```bash
cd frontend
npm install
```

## Command Line Options

The build script supports the following options:

```bash
# Run the web app
./build.sh

# Run the Tauri desktop app
./build.sh --tauri
```

## Detailed Workflow

When you run the build script, it performs the following steps:

### 1. Dependency Check

The script verifies that your system has the necessary tools installed:
- Node.js and npm (for frontend)
- Python 3 (preferably versions 3.8-3.11)
- pip (matching your Python version)
- Rust and Cargo (for Tauri builds, required only when using --tauri)

### 2. Virtual Environment Check

- Checks if either a `venv` or `.venv` directory exists in the backend folder
- Fails with instructions if no virtual environment is found

### 3. Frontend Dependency Check

- Checks if the node_modules directory exists
- Fails with instructions if frontend dependencies aren't installed

### 4. Running the Application

- Starts the backend FastAPI server on port 8000
- Starts either:
  - The Vite development server for web access
  - The Tauri development environment for the desktop application

### 5. Cleanup

- When you press Ctrl+C, the script gracefully shuts down all running processes

## Troubleshooting

If you encounter issues:

1. **Backend environment errors**:
   - Make sure you've created a virtual environment in the backend directory
   - Install dependencies: `pip install -r requirements.txt`
   - If you get package installation errors (especially with pydantic-core), try using Python 3.10 or 3.11

2. **Frontend dependency errors**:
   - Make sure you've run `npm install` in the frontend directory
   - The script only checks if node_modules exists, not the content

3. **Connection issues between frontend and backend**:
   - Verify that the URLs in `frontend/.env` match the backend configuration
   - Check for CORS issues in the backend configuration

## Manual Operation

If you prefer to run components manually or if the build script doesn't work for your environment, refer to the README.md for manual running instructions. 