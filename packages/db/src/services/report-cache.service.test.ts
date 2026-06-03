import type { IReportInputWithDates } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';
import {
  getReportCacheIneligibilityReason,
  getReportCacheKey,
  getReportCacheWriteSkipReason,
  REPORT_CACHE_MAX_BUCKET_SERIES,
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

  it('allows low-risk event property breakdown shapes', () => {
    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        breakdowns: [
          {
            id: 'viewport_bucket',
            name: 'properties.viewport_bucket',
          },
        ],
      })
    ).toBeNull();

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        limit: 10,
      })
    ).toBeNull();
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
    ).toBe('breakdowns:field');

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        breakdowns: [
          { id: 'a', name: 'properties.a' },
          { id: 'b', name: 'properties.b' },
        ],
      })
    ).toBe('breakdowns:multiple');

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        breakdowns: [{ id: 'profile-plan', name: 'profile.properties.plan' }],
      })
    ).toBe('breakdowns:field');

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        breakdowns: [{ id: 'array', name: 'properties.items.*.name' }],
      })
    ).toBe('breakdowns:wildcard');

    expect(
      getReportCacheIneligibilityReason({
        ...baseInput,
        offset: 10,
      })
    ).toBe('pagination');

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

  it('skips cache writes when a bucket expands to too many series', () => {
    const skip = getReportCacheWriteSkipReason({
      entries: [
        {
          bucketId: 'day:2026-01-01',
          bucketStart: '2026-01-01 00:00:00',
          bucketEnd: '2026-01-01 23:59:59',
          payload: Array.from(
            { length: REPORT_CACHE_MAX_BUCKET_SERIES + 1 },
            (_, index) => ({ id: `series-${index}` })
          ),
        },
      ],
    });

    expect(skip).toEqual({
      reason: 'max-series',
      bucketId: 'day:2026-01-01',
      actual: REPORT_CACHE_MAX_BUCKET_SERIES + 1,
      limit: REPORT_CACHE_MAX_BUCKET_SERIES,
    });
  });
});
