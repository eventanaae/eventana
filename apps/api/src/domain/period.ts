/**
 * The official start of Eventana's performance-counting system. Everything up to
 * the end of August 2026 was setup, testing and migration, so it must not count
 * toward anyone's events, points, rewards or incentives. From 1 September 2026
 * the counters run clean.
 *
 * Any monthly window is floored at this date: a month that starts before it uses
 * this date as its start instead, so pre-launch months resolve to an empty range
 * and show zero.
 */
export const COUNTING_START = '2026-09-01';

/** Floor a YYYY-MM-DD window start at the counting start date. */
export function flooredStart(start: string): string {
  return start < COUNTING_START ? COUNTING_START : start;
}
