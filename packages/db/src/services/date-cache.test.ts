import { DateTime } from '@openpanel/common';
import { describe, expect, it } from 'vitest';
import {
  getClosedReportCacheBuckets,
  getFullDayDateRange,
  getStrictReportCacheBoundary,
  isUtcTimezone,
} from './date.service';

describe('report cache date helpers', () => {
  it('recognizes the UTC timezones that are compatible with UTC rollups', () => {
    expect(isUtcTimezone('UTC')).toBe(true);
    expect(isUtcTimezone('Etc/UTC')).toBe(true);
    expect(isUtcTimezone('Europe/Copenhagen')).toBe(false);
  });

  it('uses the stricter previous-day boundary after the 48 hour cutoff', () => {
    const boundary = getStrictReportCacheBoundary({
      timezone: 'Europe/Copenhagen',
      now: DateTime.fromISO('2026-06-03T15:00:00', {
        zone: 'Europe/Copenhagen',
      }),
    });

    expect(boundary.cacheThroughString).toBe('2026-05-31 23:59:59');
    expect(boundary.rawFromString).toBe('2026-06-01 00:00:00');
  });

  it('splits daily ranges into cached buckets and recent raw data', () => {
    const plan = getClosedReportCacheBuckets({
      startDate: '2026-05-29 00:00:00',
      endDate: '2026-06-03 23:59:59',
      interval: 'day',
      timezone: 'Europe/Copenhagen',
      now: DateTime.fromISO('2026-06-03T15:00:00', {
        zone: 'Europe/Copenhagen',
      }),
    });

    expect(plan.buckets.map((bucket) => bucket.id)).toEqual([
      'day:2026-05-29',
      'day:2026-05-30',
      'day:2026-05-31',
    ]);
    expect(plan.rawRanges).toEqual([
      {
        startDate: '2026-06-01 00:00:00',
        endDate: '2026-06-03 23:59:59',
      },
    ]);
  });

  it('caches only full project-local months', () => {
    const plan = getClosedReportCacheBuckets({
      startDate: '2026-01-01 00:00:00',
      endDate: '2026-06-30 23:59:59',
      interval: 'month',
      timezone: 'Europe/Copenhagen',
      now: DateTime.fromISO('2026-06-03T15:00:00', {
        zone: 'Europe/Copenhagen',
      }),
    });

    expect(plan.buckets.map((bucket) => bucket.id)).toEqual([
      'month:2026-01-01',
      'month:2026-02-01',
      'month:2026-03-01',
      'month:2026-04-01',
      'month:2026-05-01',
    ]);
    expect(plan.rawRanges).toEqual([
      {
        startDate: '2026-06-01 00:00:00',
        endDate: '2026-06-30 23:59:59',
      },
    ]);
  });

  it('keeps partial prefix ranges raw', () => {
    const plan = getClosedReportCacheBuckets({
      startDate: '2026-05-29 12:00:00',
      endDate: '2026-06-01 23:59:59',
      interval: 'day',
      timezone: 'Europe/Copenhagen',
      now: DateTime.fromISO('2026-06-03T15:00:00', {
        zone: 'Europe/Copenhagen',
      }),
    });

    expect(plan.buckets.map((bucket) => bucket.id)).toEqual([
      'day:2026-05-30',
      'day:2026-05-31',
    ]);
    expect(plan.rawRanges).toEqual([
      {
        startDate: '2026-05-29 12:00:00',
        endDate: '2026-05-29 23:59:59',
      },
      {
        startDate: '2026-06-01 00:00:00',
        endDate: '2026-06-01 23:59:59',
      },
    ]);
  });

  it('recognizes full-day ranges with exclusive midnight ends', () => {
    expect(
      getFullDayDateRange({
        startDate: '2026-05-01 00:00:00',
        endDate: '2026-06-01 00:00:00',
        timezone: 'Europe/Copenhagen',
      })
    ).toEqual({
      startKey: '2026-05-01',
      endKey: '2026-05-31',
      startDate: '2026-05-01 00:00:00',
      endDate: '2026-05-31 23:59:59',
    });
  });

  it('treats date-only end dates as full-day bounds', () => {
    expect(
      getFullDayDateRange({
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        timezone: 'Europe/Copenhagen',
      })
    ).toEqual({
      startKey: '2026-05-01',
      endKey: '2026-05-31',
      startDate: '2026-05-01 00:00:00',
      endDate: '2026-05-31 23:59:59',
    });
  });

  it('rejects partial-day ranges for daily rollups', () => {
    expect(
      getFullDayDateRange({
        startDate: '2026-05-01 12:00:00',
        endDate: '2026-05-31 23:59:59',
        timezone: 'Europe/Copenhagen',
      })
    ).toBeNull();

    expect(
      getFullDayDateRange({
        startDate: '2026-05-01 00:00:00',
        endDate: '2026-05-31 12:00:00',
        timezone: 'Europe/Copenhagen',
      })
    ).toBeNull();
  });
});
