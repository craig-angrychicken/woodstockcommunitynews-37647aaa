/**
 * Utility functions for time formatting and validation
 * 
 * NOTE: All times in the database are stored in EST (Eastern Standard Time, UTC-5).
 * Edge functions run on UTC but convert to EST before comparing with scheduled times.
 */

/**
 * Convert 24-hour time format to 12-hour display with AM/PM and EST label
 * @param time24 - Time in 24-hour format (e.g., "06:00", "13:30")
 * @returns Time in 12-hour format with EST label (e.g., "6:00 AM EST", "1:30 PM EST")
 */
export function formatTime24To12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm} EST`;
}

/**
 * Convert UTC time to EST (UTC - 5 hours)
 * @param utcTime - Time in 24-hour UTC format (e.g., "11:00")
 * @returns Time in 24-hour EST format (e.g., "06:00")
 */
export function convertUTCtoEST(utcTime: string): string {
  const [hours, minutes] = utcTime.split(':').map(Number);
  const estHours = (hours - 5 + 24) % 24;
  return `${String(estHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Convert EST time to UTC (EST + 5 hours)
 * @param estTime - Time in 24-hour EST format (e.g., "06:00")
 * @returns Time in 24-hour UTC format (e.g., "11:00")
 */
export function convertESTtoUTC(estTime: string): string {
  const [hours, minutes] = estTime.split(':').map(Number);
  const utcHours = (hours + 5) % 24;
  return `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Get current time in EST format (HH:MM)
 * @returns Current time in EST as HH:MM string
 */
export function getCurrentEST(): string {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const estHours = (utcHours - 5 + 24) % 24;
  return `${String(estHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}`;
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
