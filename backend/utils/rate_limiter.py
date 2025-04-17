import time
from typing import Dict, Any, Tuple
from collections import defaultdict, deque
import logging

# Configure logging
logger = logging.getLogger(__name__)


class RateLimiter:
    """
    Simple in-memory rate limiter for API and WebSocket endpoints.

    Uses a sliding window approach to track request counts.
    """

    def __init__(self, limit: int, window: int):
        """
        Initialize a new rate limiter.

        Args:
            limit: Maximum number of requests allowed in the window
            window: Time window in seconds
        """
        self.limit = limit
        self.window = window
        # Maps user_id -> deque of timestamps
        self.request_history: Dict[str, deque] = defaultdict(
            lambda: deque(maxlen=limit + 1)
        )

    def is_allowed(self, user_id: str) -> bool:
        """
        Check if a request from the given user is allowed.

        Args:
            user_id: User identifier

        Returns:
            True if the request is allowed, False otherwise
        """
        current_time = time.time()
        history = self.request_history[user_id]

        # Add current request timestamp
        history.append(current_time)

        # If we haven't reached the limit yet
        if len(history) <= self.limit:
            return True

        # Check if oldest request is outside the window
        oldest = history[0]
        if current_time - oldest > self.window:
            # Remove the oldest timestamp
            history.popleft()
            return True

        # Rate limit exceeded
        logger.warning(
            f"Rate limit exceeded for user {user_id}: {len(history)} requests in {self.window} seconds"
        )
        return False

    def get_remaining(self, user_id: str) -> Tuple[int, int]:
        """
        Get the number of remaining requests and reset time.

        Args:
            user_id: User identifier

        Returns:
            Tuple of (remaining requests, seconds until reset)
        """
        current_time = time.time()
        history = self.request_history.get(user_id, deque(maxlen=self.limit + 1))

        # If no requests or queue not full, return full limit
        if not history:
            return self.limit, self.window

        # Filter out timestamps outside the current window
        window_start_time = current_time - self.window
        in_window = [t for t in history if t > window_start_time]

        # Calculate remaining
        remaining = max(0, self.limit - len(in_window))

        # Calculate reset time
        if not in_window:
            reset_time = self.window
        else:
            oldest_in_window = min(in_window)
            reset_time = max(0, self.window - (current_time - oldest_in_window))

        return remaining, int(reset_time)

    def reset(self, user_id: str = None):
        """
        Reset rate limits for a specific user or all users.

        Args:
            user_id: User identifier, or None to reset all
        """
        if user_id:
            if user_id in self.request_history:
                del self.request_history[user_id]
                logger.debug(f"Reset rate limit for user {user_id}")
        else:
            self.request_history.clear()
            logger.debug("Reset all rate limits")
