/**
 * Utility functions for time formatting and validation
 *
 * NOTE: All times in the database are stored in ET (Eastern Time).
 * Uses Intl.DateTimeFormat with America/New_York to handle EST/EDT automatically.
 */

/**
 * Get the current UTC offset for America/New_York in hours (e.g., -5 for EST, -4 for EDT)
 */
function getETOffsetHours(date: Date = new Date()): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const utcDate = new Date(utcStr);
  const etDate = new Date(etStr);
  return (etDate.getTime() - utcDate.getTime()) / (60 * 60 * 1000);
}

/**
 * Convert 24-hour time format to 12-hour display with AM/PM and ET label
 * @param time24 - Time in 24-hour format (e.g., "06:00", "13:30")
 * @returns Time in 12-hour format with ET label (e.g., "6:00 AM ET", "1:30 PM ET")
 */
export function formatTime24To12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm} ET`;
}

/**
 * Convert UTC time to ET (handles EST/EDT automatically)
 * @param utcTime - Time in 24-hour UTC format (e.g., "11:00")
 * @returns Time in 24-hour ET format (e.g., "07:00" during EDT, "06:00" during EST)
 */
export function convertUTCtoEST(utcTime: string): string {
  const [hours, minutes] = utcTime.split(':').map(Number);
  const offset = getETOffsetHours();
  const etHours = (hours + offset + 24) % 24;
  return `${String(Math.floor(etHours)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Convert ET time to UTC (handles EST/EDT automatically)
 * @param estTime - Time in 24-hour ET format (e.g., "06:00")
 * @returns Time in 24-hour UTC format (e.g., "10:00" during EDT, "11:00" during EST)
 */
export function convertESTtoUTC(estTime: string): string {
  const [hours, minutes] = estTime.split(':').map(Number);
  const offset = getETOffsetHours();
  const utcHours = (hours - offset + 24) % 24;
  return `${String(Math.floor(utcHours)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Get current time in ET format (HH:MM)
 * @returns Current time in ET as HH:MM string
 */
export function getCurrentEST(): string {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // toLocaleString with hour12:false may return "24:xx" for midnight in some engines
  const [h, m] = etStr.split(':').map(s => s.trim());
  const hour = parseInt(h) % 24;
  return `${String(hour).padStart(2, '0')}:${m}`;
}

/**
 * Validate time string format
 * @param timeStr - Time string to validate
 * @returns True if valid 24-hour format (HH:MM)
 */
export function validateTime(timeStr: string): boolean {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(timeStr);
}

/**
 * Sort times chronologically
 * @param times - Array of time strings in 24-hour format
 * @returns Sorted array of times
 */
export function sortTimes(times: string[]): string[] {
  return times.sort((a, b) => {
    const [aHour, aMin] = a.split(':').map(Number);
    const [bHour, bMin] = b.split(':').map(Number);
    return (aHour * 60 + aMin) - (bHour * 60 + bMin);
  });
}

/**
 * Convert time to minutes since midnight for comparison
 * @param time24 - Time in 24-hour format
 * @returns Minutes since midnight
 */
export function timeToMinutes(time24: string): number {
  const [hours, minutes] = time24.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Format a UTC timestamp to ET display format
 * @param utcTimestamp - ISO timestamp string from database (UTC)
 * @param formatStr - Format hint (default: "MMM d, h:mm a"). If it contains 'yyyy', year is included.
 * @returns Formatted time string in ET with " ET" suffix
 */
export function formatUTCtoEST(utcTimestamp: string, formatStr: string = "MMM d, h:mm a"): string {
  const date = new Date(utcTimestamp);

  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };

  if (formatStr.includes('yyyy')) {
    options.year = 'numeric';
  }

  const formatted = date.toLocaleString('en-US', options);
  return `${formatted} ET`;
}
