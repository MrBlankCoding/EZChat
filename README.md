# EZChat Application

This repository contains the EZChat application with a Python FastAPI backend and a React frontend with Tauri desktop app support.

## Features

- 🔒 Secure user authentication with Firebase Auth
- 💬 Real-time messaging using custom WebSocket protocol
- 📁 File sharing (images, videos, documents) via Firebase Storage
- 👥 Contact management
- ✅ Read receipts and typing indicators
- 💾 Persistent chat history

## Tech Stack

- **Frontend**:
  - [Tauri](https://tauri.app/): Cross-platform desktop application framework
  - [React](https://reactjs.org/): UI library
  - [Tailwind CSS](https://tailwindcss.com/): Utility-first CSS framework

- **Backend**:
  - [FastAPI](https://fastapi.tiangolo.com/): Python-based REST API and WebSocket server
  - [MongoDB](https://www.mongodb.com/): NoSQL database for storing users, messages, and chat data

- **Authentication & Storage**:
  - [Firebase Auth](https://firebase.google.com/products/auth): User authentication
  - [Firebase Storage](https://firebase.google.com/products/storage): File storage

## Prerequisites

Before running the application, make sure you have the following installed:

- **Node.js and npm**: Required for the frontend (v14+ recommended)
- **Python 3.x**: Required for the backend (v3.8-3.11 recommended, Python 3.13 may have compatibility issues)
- **pip**: Required for installing Python dependencies
- **Rust and Cargo**: Required for Tauri desktop builds (only needed if running the desktop app)

## Setup Instructions

Before running the build script, you must manually set up the environment:

### Backend Setup

```bash
cd backend
python3 -m venv venv  # Use python3.10 or python3.11 for best compatibility
source venv/bin/activate
pip install -r requirements.txt
```

The build script will recognize either a `venv` or `.venv` directory in the backend folder.

### Frontend Setup

```bash
cd frontend
npm install
```

## Running the Application

After setting up the environment, you can use the build script to run both the backend and frontend components.

### Basic Usage

To run the web application (backend API server + frontend web):

```bash
./build.sh
```

### Running the Tauri Desktop App

To run the Tauri desktop application instead of the web interface:

```bash
./build.sh --tauri
```

The build script will verify that the required environments are set up before starting the servers.

## Manual Running

If you prefer to run components separately:

### Backend

```bash
cd backend
source venv/bin/activate  # Or source .venv/bin/activate if using .venv
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend (Web)

```bash
cd frontend
npm run dev
```

### Frontend (Tauri Desktop)

```bash
cd frontend
npm run tauri dev
```

## Environment Variables

The application uses environment variables for configuration:

- Backend: See `.env` file in the backend directory
- Frontend: See `.env` file in the frontend directory

## Stopping the Application

When using the build script, press `Ctrl+C` to gracefully stop all components.

## Project Structure

```
ezchat/
├── backend/                # Python FastAPI backend
│   ├── api/                # REST API endpoints
│   ├── auth/               # Authentication logic
│   ├── db/                 # Database models and connections
│   ├── models/             # Data models
│   ├── schemas/            # Pydantic schemas
│   ├── utils/              # Utility functions
│   ├── websocket/          # WebSocket server
│   ├── main.py             # Main application entrypoint
│   ├── requirements.txt    # Python dependencies
│   └── .env.example        # Example environment variables
│
├── frontend/               # Tauri + React frontend
│   ├── src-tauri/          # Tauri native code
│   ├── src/                # React code
│   │   ├── assets/         # Static assets
│   │   ├── components/     # Reusable React components
│   │   ├── contexts/       # React contexts
│   │   ├── hooks/          # Custom React hooks
│   │   ├── pages/          # App pages/routes
│   │   ├── services/       # Service integrations
│   │   └── utils/          # Utility functions
│   ├── package.json        # Node dependencies
│   └── .env.example        # Example environment variables
│
└── docs/                   # Documentation
    └── ws_protocol.md      # WebSocket protocol documentation
```

## WebSocket Protocol

See the [WebSocket Protocol Documentation](docs/ws_protocol.md) for details on the real-time messaging protocol.

## License

MIT 