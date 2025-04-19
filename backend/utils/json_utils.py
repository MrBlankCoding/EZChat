import json
from datetime import datetime


class DateTimeEncoder(json.JSONEncoder):
    """
    Custom JSON encoder that handles datetime objects by converting them to ISO format strings.
    """

    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


def dumps(obj, **kwargs):
    """
    JSON dumps with datetime handling.

    Args:
        obj: The object to serialize
        **kwargs: Additional arguments to pass to json.dumps

    Returns:
        JSON string with datetime objects converted to ISO format
    """
    return json.dumps(obj, cls=DateTimeEncoder, **kwargs)
