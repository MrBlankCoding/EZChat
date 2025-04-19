import uvicorn
import logging
import os
import psutil
import platform
from datetime import datetime
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, ORJSONResponse
from dotenv import load_dotenv
from contextlib import asynccontextmanager
import time
import orjson

# Load environment variables
load_dotenv()

# Import routers
from api.routes.user import router as user_router
from api.routes.chat import router as chat_router
from api.routes.contact import router as contact_router
from api.routes.group import router as group_router
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

# Set FastAPI's access logs to a higher level to reduce verbosity
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
# Reduce noise from connection events
logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
# Only show HTTP requests in debug mode
if os.getenv("DEBUG", "False").lower() != "true":
    logging.getLogger("uvicorn").setLevel(logging.WARNING)


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


# Initialize FastAPI app with performance-optimized settings
app = FastAPI(
    title="EZChat Backend API",
    description="Backend API for EZChat application",
    version="1.0.0",
    lifespan=lifespan,
    # Use orjson for faster JSON serialization/deserialization
    default_response_class=ORJSONResponse,
    # Don't validate response model by default for better performance
    response_model_exclude_unset=True,
    response_model_exclude_none=True,
    # Customize OpenAPI to minimize its size
    openapi_url=(
        "/api/openapi.json" if os.getenv("DEBUG", "False").lower() == "true" else None
    ),
    docs_url="/docs" if os.getenv("DEBUG", "False").lower() == "true" else None,
    redoc_url="/redoc" if os.getenv("DEBUG", "False").lower() == "true" else None,
)

# Configure CORS with optimized settings
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
        "http://127.0.0.1:8000",
        # Add with wildcard ports
        "http://localhost:*",
        "http://127.0.0.1:*",
    ]
    # Remove any empty strings
    allowed_origins = [origin for origin in allowed_origins if origin]

logger.info(f"Configured CORS with origins: {allowed_origins}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  # Use the dynamically built list
    allow_origin_regex=r"https?://(localhost|127\\.0\\.0\\.1|192\\.168\\.0\\.\\d{1,3}|your_domain_name\\.com)(:[0-9]+)?",  # Updated regex
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,  # Cache preflight requests for 10 minutes
)


# Add request logging middleware with performance optimization
@app.middleware("http")
async def log_requests(request: Request, call_next):
    # Skip logging for static files and health checks
    path = request.url.path
    if path.startswith("/static") or path == "/health" or path == "/favicon.ico":
        return await call_next(request)

    # Track request processing time for performance monitoring
    start_time = time.time()

    # Only log non-GET requests or if debug is enabled
    if request.method != "GET" or os.getenv("DEBUG", "False").lower() == "true":
        logger.debug(f"Request: {request.method} {path}")

    response = await call_next(request)

    # Calculate processing time
    process_time = time.time() - start_time

    # Log slow responses (> 1 second) or error responses
    if process_time > 1.0 or response.status_code >= 400:
        logger.info(
            f"Response: {request.method} {path} - Status: {response.status_code} - Time: {process_time:.2f}s"
        )

    # Add processing time header for performance monitoring
    response.headers["X-Process-Time"] = str(process_time)

    return response


# Add custom CORS headers middleware - simplify for better performance
@app.middleware("http")
async def add_cors_headers(request: Request, call_next):
    # Process the request and get the response
    response = await call_next(request)

    # Add CORS headers to every response
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"

    # For preflight requests
    if request.method == "OPTIONS":
        response.status_code = 200
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, PUT, DELETE, OPTIONS, PATCH"
        )
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, Accept"
        )

    return response


# Include routers
app.include_router(user_router, prefix="/api/user", tags=["Users"])
app.include_router(chat_router, prefix="/api/chats", tags=["Chats"])
app.include_router(contact_router, prefix="/api/contacts", tags=["Contacts"])
app.include_router(group_router, prefix="/api/groups", tags=["Groups"])
app.include_router(websocket_router)


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    return {
        "message": "Welcome to EZChat API",
        "docs": "/docs",
        "status": "operational",
    }


# Optimized health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}


# System monitoring endpoint
@app.get("/api/system", tags=["System"])
async def system_info():
    """Get system performance metrics for monitoring."""
    if os.getenv("DEBUG", "False").lower() != "true":
        return {"error": "This endpoint is only available in debug mode"}

    # Get system metrics
    cpu_percent = psutil.cpu_percent(interval=0.1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    # Get server uptime
    boot_time = datetime.fromtimestamp(psutil.boot_time())
    uptime = datetime.now() - boot_time

    # Get process info
    process = psutil.Process(os.getpid())
    process_memory = process.memory_info().rss / (1024 * 1024)  # MB

    # Get active connections count (approximate)
    connections = len(process.connections())

    return {
        "system": {
            "cpu_percent": cpu_percent,
            "memory_percent": memory.percent,
            "memory_used_gb": memory.used / (1024**3),
            "memory_total_gb": memory.total / (1024**3),
            "disk_percent": disk.percent,
            "disk_free_gb": disk.free / (1024**3),
            "disk_total_gb": disk.total / (1024**3),
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "uptime_seconds": uptime.total_seconds(),
        },
        "process": {
            "memory_mb": process_memory,
            "connections": connections,
            "threads": process.num_threads(),
            "pid": process.pid,
        },
        "timestamp": datetime.now().isoformat(),
    }


if __name__ == "__main__":
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    reload = os.getenv("DEBUG", "False").lower() == "true"
    workers = int(os.getenv("WORKERS", "0")) or None  # Set to None for auto-detection

    logger.info(
        f"Starting server on {host}:{port} with {workers or 'auto-detected'} workers"
    )

    # In debug/reload mode, we can't use multiple workers
    if reload:
        workers = None
        logger.info("Debug mode enabled - workers set to 1 for hot reloading")

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        workers=None if reload else workers,  # Can't use workers with reload
        loop="uvloop",  # Use uvloop for better performance
        http="httptools",  # Use httptools for better performance
        limit_concurrency=1000,  # Limit concurrent connections
        backlog=2048,  # Increase connection queue size
        timeout_keep_alive=5,  # Reduce idle connection time
    )
