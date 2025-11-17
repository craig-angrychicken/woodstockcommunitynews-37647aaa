/**
 * Utility functions for time formatting and validation
 */

/**
 * Convert 24-hour time format to 12-hour display with AM/PM
 * @param time24 - Time in 24-hour format (e.g., "06:00", "13:30")
 * @returns Time in 12-hour format (e.g., "6:00 AM", "1:30 PM")
 */
export function formatTime24To12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
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
