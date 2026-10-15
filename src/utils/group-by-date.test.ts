import { dateSectionLabel, groupByDate } from './group-by-date';

const now = new Date(2026, 9, 2, 12, 0, 0);

describe('dateSectionLabel', () => {
  it('labels today and yesterday', () => {
    expect(dateSectionLabel(new Date(2026, 9, 2, 8).toISOString(), now)).toBe('Today');
    expect(dateSectionLabel(new Date(2026, 9, 1, 8).toISOString(), now)).toBe('Yesterday');
  });

  it('returns Unknown for missing or invalid dates', () => {
    expect(dateSectionLabel(undefined, now)).toBe('Unknown');
    expect(dateSectionLabel('not-a-date', now)).toBe('Unknown');
  });
});

describe('groupByDate', () => {
  it('groups items under one section per day, preserving order', () => {
    const items = [
      { id: 'a', at: new Date(2026, 9, 2, 9).toISOString() },
      { id: 'b', at: new Date(2026, 9, 2, 7).toISOString() },
      { id: 'c', at: new Date(2026, 9, 1, 7).toISOString() },
    ];
    const sections = groupByDate(items, (i) => i.at, now);
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Yesterday']);
    expect(sections[0].data.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
