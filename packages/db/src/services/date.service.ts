import { DateTime } from '@openpanel/common';
import type { IChartRange, IReportInput } from '@openpanel/validation';

export type CacheableReportInterval = 'day' | 'week' | 'month';

const REPORT_CACHE_LAG_HOURS = 48;
const CHART_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss';
const UTC_TIMEZONES = new Set(['UTC', 'Etc/UTC']);

export function isUtcTimezone(timezone: string) {
  return UTC_TIMEZONES.has(timezone);
}

export function resolveDateRange(
  startDate?: string,
  endDate?: string
): { startDate: string; endDate: string } {
  const end = endDate ?? new Date().toISOString().slice(0, 10);
  const start =
    startDate ??
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

export function getDatesFromRange(range: IChartRange, timezone: string) {
  if (range === '30min' || range === 'lastHour') {
    const minutes = range === '30min' ? 30 : 60;
    const startDate = DateTime.now()
      .minus({ minute: minutes })
      .startOf('minute')
      .setZone(timezone)
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('minute')
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === 'last24h') {
    const startDate = DateTime.now()
      .minus({ hour: 24 })
      .startOf('minute')
      .setZone(timezone)
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('minute')
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === 'today') {
    const startDate = DateTime.now()
      .setZone(timezone)
      .startOf('day')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('day')
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === 'yesterday') {
    const startDate = DateTime.now()
      .minus({ day: 1 })
      .setZone(timezone)
      .startOf('day')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .minus({ day: 1 })
      .setZone(timezone)
      .endOf('day')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    return {
      startDate,
      endDate,
    };
  }

  if (range === '7d') {
    const startDate = DateTime.now()
      .minus({ day: 7 })
      .setZone(timezone)
      .startOf('day')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('day')
      .plus({ millisecond: 1 })
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === '3m') {
    const startDate = DateTime.now()
      .minus({ month: 3 })
      .setZone(timezone)
      .startOf('day')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('day')
      .plus({ millisecond: 1 })
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === '6m') {
    const startDate = DateTime.now()
      .minus({ month: 6 })
      .setZone(timezone)
      .startOf('day')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('day')
      .plus({ millisecond: 1 })
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === '12m') {
    const startDate = DateTime.now()
      .minus({ month: 12 })
      .setZone(timezone)
      .startOf('month')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('month')
      .plus({ millisecond: 1 })
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === 'monthToDate') {
    const startDate = DateTime.now()
      .setZone(timezone)
      .startOf('month')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('day')
      .plus({ millisecond: 1 })
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === 'lastMonth') {
    const month = DateTime.now()
      .minus({ month: 1 })
      .setZone(timezone)
      .startOf('month');

    const startDate = month.toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = month
      .endOf('month')
      .plus({ millisecond: 1 })
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === 'yearToDate') {
    const startDate = DateTime.now()
      .setZone(timezone)
      .startOf('year')
      .toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = DateTime.now()
      .setZone(timezone)
      .endOf('day')
      .plus({ millisecond: 1 })
      .toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  if (range === 'lastYear') {
    const year = DateTime.now().minus({ year: 1 }).setZone(timezone);
    const startDate = year.startOf('year').toFormat('yyyy-MM-dd HH:mm:ss');
    const endDate = year.endOf('year').toFormat('yyyy-MM-dd HH:mm:ss');

    return {
      startDate,
      endDate,
    };
  }

  // range === '30d'
  const startDate = DateTime.now()
    .minus({ day: 30 })
    .setZone(timezone)
    .startOf('day')
    .toFormat('yyyy-MM-dd HH:mm:ss');
  const endDate = DateTime.now()
    .setZone(timezone)
    .endOf('day')
    .plus({ millisecond: 1 })
    .toFormat('yyyy-MM-dd HH:mm:ss');

  return {
    startDate,
    endDate,
  };
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function normalizeBoundary(value: string, boundary: 'start' | 'end'): string {
  if (DATE_ONLY_REGEX.test(value)) {
    return boundary === 'start' ? `${value} 00:00:00` : `${value} 23:59:59`;
  }
  return value;
}

export function getChartStartEndDate(
  {
    startDate,
    endDate,
    range,
  }: Pick<IReportInput, 'endDate' | 'startDate' | 'range'>,
  timezone: string
) {
  const normalizedStart = startDate
    ? normalizeBoundary(startDate, 'start')
    : startDate;
  const normalizedEnd = endDate ? normalizeBoundary(endDate, 'end') : endDate;

  if (normalizedStart && normalizedEnd) {
    return { startDate: normalizedStart, endDate: normalizedEnd };
  }

  const ranges = getDatesFromRange(range, timezone);
  if (!normalizedStart && normalizedEnd) {
    return { startDate: ranges.startDate, endDate: normalizedEnd };
  }

  return ranges;
}

function parseChartDate(value: string, timezone: string) {
  return DateTime.fromFormat(value, CHART_DATE_FORMAT, { zone: timezone });
}

function parseFlexibleChartDate(value: string, timezone: string) {
  const chartDate = parseChartDate(value, timezone);
  if (chartDate.isValid) {
    return chartDate;
  }

  return DateTime.fromISO(value, { zone: timezone });
}

function formatChartDate(value: DateTime) {
  return value.toFormat(CHART_DATE_FORMAT);
}

function parseReportBucketDate(value: string, timezone: string) {
  const iso = DateTime.fromISO(value, { zone: timezone });
  if (iso.isValid) {
    return iso;
  }
  return parseChartDate(value, timezone);
}

function getBucketStart(value: DateTime, interval: CacheableReportInterval) {
  switch (interval) {
    case 'day':
      return value.startOf('day');
    case 'week':
      return value.startOf('week');
    case 'month':
      return value.startOf('month');
  }
}

function getNextBucketStart(
  value: DateTime,
  interval: CacheableReportInterval
) {
  switch (interval) {
    case 'day':
      return value.plus({ days: 1 }).startOf('day');
    case 'week':
      return value.plus({ weeks: 1 }).startOf('week');
    case 'month':
      return value.plus({ months: 1 }).startOf('month');
  }
}

export function getStrictReportCacheBoundary({
  timezone,
  now = DateTime.now(),
  lagHours = REPORT_CACHE_LAG_HOURS,
}: {
  timezone: string;
  now?: DateTime;
  lagHours?: number;
}) {
  const cutoff = now.setZone(timezone).minus({ hours: lagHours });
  const cacheThrough = cutoff.minus({ days: 1 }).endOf('day');
  const rawFrom = cacheThrough.plus({ days: 1 }).startOf('day');

  return {
    cutoff,
    cacheThrough,
    rawFrom,
    cacheThroughString: formatChartDate(cacheThrough),
    rawFromString: formatChartDate(rawFrom),
  };
}

export interface ReportCacheBucket {
  id: string;
  startDate: string;
  endDate: string;
}

export interface ReportCacheRange {
  startDate: string;
  endDate: string;
}

export function getClosedReportCacheBuckets({
  startDate,
  endDate,
  interval,
  timezone,
  now,
}: {
  startDate: string;
  endDate: string;
  interval: CacheableReportInterval;
  timezone: string;
  now?: DateTime;
}): {
  buckets: ReportCacheBucket[];
  rawRanges: ReportCacheRange[];
  cacheThrough: string;
  rawFrom: string;
} {
  const rangeStart = parseChartDate(startDate, timezone);
  const rangeEnd = parseChartDate(endDate, timezone);
  const { cacheThrough, cacheThroughString, rawFromString } =
    getStrictReportCacheBoundary({ timezone, now });

  const buckets: ReportCacheBucket[] = [];
  const rawRanges: ReportCacheRange[] = [];

  if (!(rangeStart.isValid && rangeEnd.isValid) || rangeEnd < rangeStart) {
    return {
      buckets,
      rawRanges: [{ startDate, endDate }],
      cacheThrough: cacheThroughString,
      rawFrom: rawFromString,
    };
  }

  const firstBucketStart = (() => {
    const aligned = getBucketStart(rangeStart, interval);
    return aligned < rangeStart
      ? getNextBucketStart(aligned, interval)
      : aligned;
  })();

  let cursor = firstBucketStart;
  while (cursor <= rangeEnd) {
    const nextStart = getNextBucketStart(cursor, interval);
    const bucketEnd = nextStart.minus({ seconds: 1 });

    if (bucketEnd > rangeEnd || bucketEnd > cacheThrough) {
      break;
    }

    buckets.push({
      id: `${interval}:${cursor.toISODate()}`,
      startDate: formatChartDate(cursor),
      endDate: formatChartDate(bucketEnd),
    });
    cursor = nextStart;
  }

  const firstBucket = buckets[0];
  if (
    firstBucket &&
    rangeStart < parseChartDate(firstBucket.startDate, timezone)
  ) {
    rawRanges.push({
      startDate: formatChartDate(rangeStart),
      endDate: formatChartDate(
        parseChartDate(firstBucket.startDate, timezone).minus({ seconds: 1 })
      ),
    });
  }

  const lastBucket = buckets.at(-1);
  const rawStart = lastBucket
    ? parseChartDate(lastBucket.endDate, timezone).plus({ seconds: 1 })
    : rangeStart;

  if (rawStart <= rangeEnd) {
    rawRanges.push({
      startDate: formatChartDate(rawStart),
      endDate: formatChartDate(rangeEnd),
    });
  }

  return {
    buckets,
    rawRanges,
    cacheThrough: cacheThroughString,
    rawFrom: rawFromString,
  };
}

export function getReportCacheBucketIdForDate({
  date,
  interval,
  timezone,
}: {
  date: string;
  interval: CacheableReportInterval;
  timezone: string;
}) {
  const parsed = parseReportBucketDate(date, timezone);
  if (!parsed.isValid) {
    return null;
  }

  return `${interval}:${getBucketStart(parsed, interval).toISODate()}`;
}

export function getFullDayDateRange({
  startDate,
  endDate,
  timezone,
}: {
  startDate: string;
  endDate: string;
  timezone: string;
}): {
  startDate: string;
  endDate: string;
  startKey: string;
  endKey: string;
} | null {
  const start = parseFlexibleChartDate(startDate, timezone);
  const end = parseFlexibleChartDate(endDate, timezone);

  if (!(start.isValid && end.isValid) || end < start) {
    return null;
  }

  const firstFullDay = start.startOf('day');
  if (start > firstFullDay) {
    return null;
  }

  const endDayStart = end.startOf('day');
  const endIsDateOnly = DATE_ONLY_REGEX.test(endDate);
  const endIncludesFullDay =
    endIsDateOnly || end >= endDayStart.plus({ days: 1 }).minus({ seconds: 1 });
  const lastFullDay = endIncludesFullDay
    ? endDayStart
    : end.equals(endDayStart)
      ? endDayStart.minus({ days: 1 })
      : null;

  if (!lastFullDay || firstFullDay > lastFullDay) {
    return null;
  }

  const startKey = firstFullDay.toISODate();
  const endKey = lastFullDay.toISODate();
  if (!(startKey && endKey)) {
    return null;
  }

  return {
    startKey,
    endKey,
    startDate: `${startKey} 00:00:00`,
    endDate: `${endKey} 23:59:59`,
  };
}

export function getChartPrevStartEndDate({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  let diff = DateTime.fromFormat(endDate, 'yyyy-MM-dd HH:mm:ss').diff(
    DateTime.fromFormat(startDate, 'yyyy-MM-dd HH:mm:ss')
  );

  if ((diff.milliseconds / 1000) % 2 !== 0) {
    diff = diff.plus({ millisecond: 1 });
  }

  return {
    startDate: DateTime.fromFormat(startDate, 'yyyy-MM-dd HH:mm:ss')
      .minus({ millisecond: diff.milliseconds })
      .toFormat('yyyy-MM-dd HH:mm:ss'),
    endDate: DateTime.fromFormat(endDate, 'yyyy-MM-dd HH:mm:ss')
      .minus({ millisecond: diff.milliseconds })
      .toFormat('yyyy-MM-dd HH:mm:ss'),
  };
}
