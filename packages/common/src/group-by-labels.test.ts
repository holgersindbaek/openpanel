import { describe, expect, it } from 'vitest';
import { groupByLabels, type ISerieDataItem } from './group-by-labels';

describe('groupByLabels', () => {
  it('fills missing dates in sorted order without changing grouped values', () => {
    const rows: ISerieDataItem[] = [
      {
        label_0: 'page_view',
        label_1: 'US',
        count: 3,
        total_count: 10,
        date: '2026-01-03',
      },
      {
        label_0: 'page_view',
        label_1: 'DK',
        count: 2,
        total_count: 7,
        date: '2026-01-01',
      },
      {
        label_0: 'page_view',
        label_1: 'US',
        count: 5,
        total_count: 10,
        date: '2026-01-01',
      },
    ];

    expect(groupByLabels(rows)).toEqual([
      {
        name: ['page_view', 'US'],
        data: [
          { date: '2026-01-01', count: 5, total_count: 10 },
          { date: '2026-01-03', count: 3, total_count: 10 },
        ],
      },
      {
        name: ['page_view', 'DK'],
        data: [
          { date: '2026-01-01', count: 2, total_count: 7 },
          { date: '2026-01-03', count: 0, total_count: 0 },
        ],
      },
    ]);
  });
});
