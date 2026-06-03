import type { IReportInputWithDates } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';
import {
  getReportCacheIneligibilityReason,
  getReportCacheKey,
  stableStringify,
} from './report-cache.service';

const baseInput: IReportInputWithDates = {
  projectId: 'project-1',
  chartType: 'linear',
  interval: 'day',
  series: [
    {
      type: 'event',
      id: 'A',
      name: 'screen_view',
      segment: 'event',
      filters: [],
    },
  ],
  breakdowns: [],
  range: '30d',
  startDate: '2026-01-01 00:00:00',
  endDate: '2026-01-31 23:59:59',
  previous: false,
  metric: 'sum',
};

describe('report-cache.service', () => {
  it('uses a stable sorted JSON representation', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}'
    );
  });

  it('does not include the requested date range in the cache key', () => {
    const first = getReportCacheKey(baseInput, 'Europe/Copenhagen');
    const second = getReportCacheKey(
      {
        ...baseInput,
        startDate: '2026-02-01 00:00:00',
        endDate: '2026-02-28 23:59:59',
      },
      'Europe/Copenhagen'
    );

    expect(first).toBe(second);
  });

  it('includes timezone in the cache key', () => {
    expect(getReportCacheKey(baseInput, 'UTC')).not.toBe(
      getReportCacheKey(baseInput, 'Europe/Copenhagen')
    );
  });

  it('includes metric in the cache key', () => {
    expect(
      getReportCacheKey({ ...baseInput, metric: 'sum' }, 'Europe/Copenhagen')
    ).not.toBe(
      getReportCacheKey(
        { ...baseInput, metric: 'average' },
        'Europe/Copenhagen'
      )
    );
  });

  it('allows simple event reports', () => {
    expect(getReportCacheIneligibilityReason(baseInput)).toBeNull();
  });

  it('rejects dynamic report shapes', () => {
    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        includeTotalCount: true,
      })
    ).toBe('total-count');

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        breakdowns: [{ id: 'country', name: 'country' }],
      })
    ).toBe('breakdowns');

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        series: [
          {
            type: 'event',
            id: 'A',
            name: 'screen_view',
            segment: 'first_seen',
            filters: [],
          },
        ],
      })
    ).toBe('segment:first_seen');

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        series: [
          {
            type: 'event',
            id: 'A',
            name: 'screen_view',
            segment: 'event',
            filters: [
              {
                id: 'profile-plan',
                name: 'profile.properties.plan',
                operator: 'is',
                value: ['pro'],
              },
            ],
          },
        ],
      })
    ).toBe('dynamic-filter');
  });
});
