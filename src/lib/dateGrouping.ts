/**
 * Reusable utility to group items by date ranges (YouTube-style)
 * Groups: Today, Yesterday, This week, This month, This year, Older
 */

export interface DateGroupedResult<T> {
  label: string;
  posts: T[];
}

export function groupByDateRanges<T extends { createdAt: Date | string }>(
  items: T[]
): DateGroupedResult<T>[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - now.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const groups = {
    today: [] as T[],
    yesterday: [] as T[],
    thisWeek: [] as T[],
    thisMonth: [] as T[],
    thisYear: [] as T[],
    older: [] as T[],
  };

  items.forEach((item) => {
    const date = new Date(item.createdAt);
    if (date >= today) groups.today.push(item);
    else if (date >= yesterday) groups.yesterday.push(item);
    else if (date >= weekStart) groups.thisWeek.push(item);
    else if (date >= monthStart) groups.thisMonth.push(item);
    else if (date >= yearStart) groups.thisYear.push(item);
    else groups.older.push(item);
  });

  const result: DateGroupedResult<T>[] = [];
  if (groups.today.length) result.push({ label: 'Today', posts: groups.today });
  if (groups.yesterday.length) result.push({ label: 'Yesterday', posts: groups.yesterday });
  if (groups.thisWeek.length) result.push({ label: 'This week', posts: groups.thisWeek });
  if (groups.thisMonth.length) result.push({ label: 'This month', posts: groups.thisMonth });
  if (groups.thisYear.length) result.push({ label: 'This year', posts: groups.thisYear });
  if (groups.older.length) result.push({ label: 'Older', posts: groups.older });

  return result;
}
