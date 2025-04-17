import uvicorn
import logging
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from contextlib import asynccontextmanager

# Load environment variables
load_dotenv()

# Import routers
from api.routes.user import router as user_router
from api.routes.chat import router as chat_router
from api.routes.contact import router as contact_router
from websocket.manager import websocket_router
from db.mongodb import connect_to_mongodb, close_mongodb_connection

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format=os.getenv(
        "LOG_FORMAT", "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    ),
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for FastAPI application.
    Handles startup and shutdown events.
    """
    # Startup
    logger.info("Starting up the application...")
    await connect_to_mongodb()

    yield

    # Shutdown
    logger.info("Shutting down the application...")
    await close_mongodb_connection()


# Initialize FastAPI app
app = FastAPI(
    title="EZChat Backend API",
    description="Backend API for EZChat application",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS
allowed_origins = os.getenv("CORS_ORIGINS", "").split(",")
# For development, include explicit origins
if os.getenv("DEBUG", "False").lower() == "true":
    # In debug mode, add specific origins and make sure they don't contain empty strings
    allowed_origins = [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://localhost",
        "http://localhost:8000",
    ]
    # Remove any empty strings
    allowed_origins = [origin for origin in allowed_origins if origin]

logger.info(f"Configured CORS with origins: {allowed_origins}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:[0-9]+)?",  # Allow any localhost port
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,  # Cache preflight requests for 10 minutes
)


# Add request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.debug(f"Request: {request.method} {request.url.path}")
    response = await call_next(request)
    logger.debug(f"Response status: {response.status_code}")
    return response


# Add custom CORS middleware to ensure headers are set for all responses
@app.middleware("http")
async def add_cors_headers(request: Request, call_next):
    # Process the request and get the response
    response = await call_next(request)

    # Add CORS headers to every response
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = (
        "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    )
    response.headers["Access-Control-Allow-Headers"] = (
        "Content-Type, Authorization, Accept"
    )

    # For preflight requests
    if request.method == "OPTIONS":
        response.status_code = 200

    return response


# Include routers
app.include_router(user_router, prefix="/api/user", tags=["Users"])
app.include_router(chat_router, prefix="/api/chats", tags=["Chats"])
app.include_router(contact_router, prefix="/api/contacts", tags=["Contacts"])
app.include_router(websocket_router)


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    return {
        "message": "Welcome to EZChat API",
        "docs": "/docs",
        "status": "operational",
    }


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    reload = os.getenv("DEBUG", "False").lower() == "true"

    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=reload)
