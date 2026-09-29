import dayjs from 'dayjs';
import calendar from 'dayjs/plugin/calendar';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
dayjs.extend(calendar);

export { dayjs };

/** Open WebUI's time bucketing: Today / Yesterday / Previous 7 days / Previous 30 days / Month / Year. */
export function getTimeRange(date: string | Date): string {
  const value = dayjs(date);
  const now = dayjs();
  if (value.isSame(now, 'day')) {
    return 'Today';
  }
  if (value.isSame(now.subtract(1, 'day'), 'day')) {
    return 'Yesterday';
  }
  const daysAgo = now.diff(value, 'day');
  if (daysAgo <= 7) {
    return 'Previous 7 days';
  }
  if (daysAgo <= 30) {
    return 'Previous 30 days';
  }
  if (value.isSame(now, 'year')) {
    return value.format('MMMM');
  }
  return value.format('YYYY');
}

export function groupByTimeRange<T>(items: T[], getDate: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const range = getTimeRange(getDate(item));
    const bucket = groups.get(range);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(range, [item]);
    }
  }
  return [...groups.entries()];
}
