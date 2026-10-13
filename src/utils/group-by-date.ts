export function dateSectionLabel(dateStr?: string, now: Date = new Date()): string {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => string | undefined,
  now: Date = new Date(),
): { title: string; data: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const label = dateSectionLabel(getDate(item), now);
    const group = map.get(label) ?? [];
    group.push(item);
    map.set(label, group);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}
