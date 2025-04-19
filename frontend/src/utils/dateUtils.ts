import { format, isToday, isYesterday, isThisWeek, isThisYear } from 'date-fns';
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
 * Format a message timestamp for display in message bubbles
 */
export function formatMessageTime(timestamp: string | number): string {
  const date = new Date(timestamp);
  
  if (isToday(date)) {
    // Today: just show time
    return format(date, 'h:mm a');
  } else if (isYesterday(date)) {
    // Yesterday
    return 'Yesterday';
  } else if (isThisWeek(date)) {
    // This week: show day name
    return format(date, 'EEEE');
  } else if (isThisYear(date)) {
    // This year: show month and day
    return format(date, 'MMM d');
  } else {
    // Previous years: show month, day and year
    return format(date, 'MMM d, yyyy');
  }
}

/**
 * Format a full date time for message details
 */
export function formatFullDateTime(timestamp: string | number): string {
  const date = new Date(timestamp);
  return format(date, 'MMMM d, yyyy h:mm a');
}

/**
 * Format a date for conversation list
 */
export function formatConversationDate(timestamp: string | number): string {
  const date = new Date(timestamp);
  
  if (isToday(date)) {
    return format(date, 'h:mm a');
  } else if (isYesterday(date)) {
    return 'Yesterday';
  } else if (isThisWeek(date)) {
    return format(date, 'EEEE');
  } else {
    return format(date, 'MM/dd/yyyy');
  }
}

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