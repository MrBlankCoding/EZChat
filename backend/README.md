# EZChat Backend - Performance Optimized

This is the backend server for EZChat, optimized for high performance and scalability.

## Performance Optimizations

The following performance optimizations have been implemented:

1. **Database Connection Pooling**
   - Configured MongoDB connection pooling with optimal settings
   - Added retry mechanisms for database operations
   - Implemented connection timeouts to prevent hanging connections

2. **In-Memory Caching**
   - Added TTL caches for frequently accessed user data
   - Implemented message caching to reduce database reads
   - Added query caching for common database operations

3. **Asynchronous Processing**
   - Implemented batch processing for message storage
   - Added asynchronous handling for read receipts
   - Used background tasks for non-critical operations

4. **Connection Management**
   - Added connection health monitoring
   - Implemented heartbeat mechanism to detect stale connections
   - Optimized connection cleanup to prevent resource leaks

5. **WebSocket Optimizations**
   - Improved WebSocket broadcast efficiency with concurrency
   - Implemented efficient message batching for read receipts
   - Added connection keep-alive with minimal overhead

6. **Resource Limiting**
   - Added semaphores to limit concurrent database operations
   - Implemented rate limiting for message processing
   - Added connection concurrency limits

7. **Server Configuration**
   - Optimized Uvicorn settings for better performance
   - Added worker process configuration
   - Configured timeouts and connection parameters

8. **Performance Monitoring**
   - Added request timing headers
   - Implemented system monitoring endpoints
   - Added detailed logging for slow operations

## Environment Variables

The following environment variables can be used to configure the performance optimizations:

```
# Database Connection Pool
MONGODB_MAX_POOL_SIZE=100
MONGODB_MIN_POOL_SIZE=10
MONGODB_MAX_IDLE_TIME_MS=60000
MONGODB_SOCKET_TIMEOUT_MS=5000
MONGODB_CONNECT_TIMEOUT_MS=5000
MONGODB_SERVER_SELECTION_TIMEOUT_MS=5000

# Caching Settings
USER_CACHE_SIZE=1000
USER_CACHE_TTL=300
MESSAGE_CACHE_SIZE=5000
MESSAGE_CACHE_TTL=60

# Concurrency Control
DB_CONCURRENCY_LIMIT=20
WORKERS=0  # 0 means auto-detection based on CPU cores
```

## Starting the Server

```bash
# Development mode
python main.py

# Production mode with optimized settings
DEBUG=False WORKERS=4 python main.py
```

## Monitoring Performance

### Response Time Headers

The server adds an `X-Process-Time` header to all responses, which indicates the processing time in seconds. You can use this to monitor performance over time.

### System Monitoring Endpoint

When in debug mode, you can access the `/api/system` endpoint to get detailed information about server performance:

```json
{
  "system": {
    "cpu_percent": 12.5,
    "memory_percent": 65.3,
    "memory_used_gb": 4.2,
    "memory_total_gb": 8.0,
    "disk_percent": 45.7,
    "disk_free_gb": 112.4,
    "disk_total_gb": 250.0,
    "platform": "macOS-13.5.1-arm64-arm-64bit",
    "python_version": "3.11.5",
    "uptime_seconds": 43200.5
  },
  "process": {
    "memory_mb": 125.7,
    "connections": 6,
    "threads": 8,
    "pid": 12345
  },
  "timestamp": "2023-06-01T12:34:56.789012"
}
```

## Further Optimization Opportunities

1. **Redis Integration**
   - Add Redis for distributed caching
   - Implement pub/sub for more efficient message distribution

2. **Database Sharding**
   - Implement database sharding for horizontal scaling
   - Add read replicas for read-heavy operations

3. **Load Testing**
   - Perform load testing to identify bottlenecks
   - Optimize based on real-world usage patterns 