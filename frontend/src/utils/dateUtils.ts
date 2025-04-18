import { format as formatDateFns } from 'date-fns';
import { format as formatTz, utcToZonedTime } from 'date-fns-tz';

/**
 * Get the user's local timezone
 */
export const getUserTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Format a date in the user's local timezone
 * @param date Date to format
 * @param formatStr Format string (date-fns format)
 * @param timezone Optional timezone to override local timezone
 */
export const formatDate = (
  date: Date | number | string,
  formatStr: string = 'p',
  timezone?: string
): string => {
  try {
    // Parse the timestamp correctly - handle different formats
    const parsedDate = typeof date === 'string' || typeof date === 'number'
      ? new Date(date)
      : date;
    
    // Use the provided timezone or default to user's local timezone
    const tz = timezone || getUserTimezone();
    
    // Convert the UTC date to the specified timezone
    const zonedDate = utcToZonedTime(parsedDate, tz);
    
    // Format with the timezone
    return formatTz(zonedDate, formatStr, { timeZone: tz });
  } catch (error) {
    console.error('Error formatting date:', error, date);
    return '';
  }
};

/**
 * Format a timestamp for a message or last seen status
 * @param timestamp Timestamp to format
 * @param timezone Optional timezone
 */
export const formatMessageTime = (
  timestamp: string | number,
  timezone?: string
): string => {
  return formatDate(timestamp, 'p', timezone);
};

/**
 * Format a date in relative time (today, yesterday, etc)
 * @param date Date to format
 * @param timezone Optional timezone
 */
export const formatRelativeTime = (
  date: Date | number | string,
  timezone?: string
): string => {
  const now = new Date();
  const parsedDate = typeof date === 'string' || typeof date === 'number'
    ? new Date(date)
    : date;
  
  // Convert to milliseconds for easy comparison
  const diffMs = now.getTime() - parsedDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return `Today at ${formatDate(parsedDate, 'p', timezone)}`;
  } else if (diffDays === 1) {
    return `Yesterday at ${formatDate(parsedDate, 'p', timezone)}`;
  } else if (diffDays < 7) {
    return formatDate(parsedDate, 'EEEE p', timezone);
  } else {
    return formatDate(parsedDate, 'MMM d, yyyy p', timezone);
  }
}; 