import { createLogger } from '@openpanel/logger';
import {
  getClosedReportCacheBuckets,
  getReportCacheBucketIdForDate,
} from '../services/date.service';
import {
  getReportCacheEntries,
  getReportCacheIneligibilityReason,
  getReportCacheKey,
  isCacheableReportInterval,
  setReportCacheEntries,
} from '../services/report-cache.service';
import { fetch as fetchRaw } from './fetch';
import type { ConcreteSeries, Plan } from './types';

const logger = createLogger({ name: 'report-cache-engine' });

type FetchOptions = {
  abortSignal?: AbortSignal;
};

function getSeriesKey(series: ConcreteSeries) {
  return [series.definitionIndex, series.definitionId, ...series.name].join(
    '\u001f'
  );
}

export function mergeConcreteSeriesChunks(
  chunks: ConcreteSeries[][]
): ConcreteSeries[] {
  const byKey = new Map<
    string,
    {
      series: ConcreteSeries;
      dataByDate: Map<string, ConcreteSeries['data'][number]>;
    }
  >();

  for (const chunk of chunks) {
    for (const series of chunk) {
      const key = getSeriesKey(series);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          series: {
            ...series,
            context: { ...series.context },
            data: [],
          },
          dataByDate: new Map(),
        };
        byKey.set(key, entry);
      }

      for (const item of series.data) {
        entry.dataByDate.set(item.date, item);
      }
    }
  }

  return Array.from(byKey.values())
    .map(({ series, dataByDate }) => ({
      ...series,
      data: Array.from(dataByDate.values()).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      ),
    }))
    .sort((a, b) => {
      if (a.definitionIndex !== b.definitionIndex) {
        return a.definitionIndex - b.definitionIndex;
      }
      return a.name.join('\u001f').localeCompare(b.name.join('\u001f'));
    });
}

function groupConsecutiveMissingBuckets<T extends { id: string }>(
  buckets: T[],
  cached: Map<string, unknown>
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];

  for (const bucket of buckets) {
    if (cached.has(bucket.id)) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      continue;
    }
    current.push(bucket);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function splitSeriesIntoBucketPayloads({
  series,
  buckets,
  interval,
  timezone,
}: {
  series: ConcreteSeries[];
  buckets: Array<{ id: string; startDate: string; endDate: string }>;
  interval: 'day' | 'week' | 'month';
  timezone: string;
}) {
  return buckets.map((bucket) => {
    const payload = series.flatMap((item) => {
      const data = item.data.filter((point) => {
        return (
          getReportCacheBucketIdForDate({
            date: point.date,
            interval,
            timezone,
          }) === bucket.id
        );
      });

      return data.length > 0
        ? [
            {
              ...item,
              context: { ...item.context },
              data,
            },
          ]
        : [];
    });

    return {
      bucketId: bucket.id,
      bucketStart: bucket.startDate,
      bucketEnd: bucket.endDate,
      payload,
    };
  });
}

async function fetchRange(
  plan: Plan,
  range: { startDate: string; endDate: string },
  options?: FetchOptions
) {
  return fetchRaw(
    {
      ...plan,
      input: {
        ...plan.input,
        startDate: range.startDate,
        endDate: range.endDate,
      },
    },
    options
  );
}

export async function fetchWithReportCache(
  plan: Plan,
  options?: FetchOptions
): Promise<ConcreteSeries[]> {
  if (process.env.REPORT_CACHE_DISABLED === 'true') {
    return fetchRaw(plan, options);
  }

  const ineligibilityReason = getReportCacheIneligibilityReason(plan.input);
  if (ineligibilityReason) {
    return fetchRaw(plan, options);
  }

  if (!isCacheableReportInterval(plan.input.interval)) {
    return fetchRaw(plan, options);
  }

  const cachePlan = getClosedReportCacheBuckets({
    startDate: plan.input.startDate,
    endDate: plan.input.endDate,
    interval: plan.input.interval,
    timezone: plan.timezone,
  });

  if (cachePlan.buckets.length === 0) {
    return fetchRaw(plan, options);
  }

  const cacheKey = getReportCacheKey(plan.input, plan.timezone);
  let cached = new Map<string, ConcreteSeries[]>();

  try {
    cached = await getReportCacheEntries<ConcreteSeries[]>({
      projectId: plan.input.projectId,
      cacheKey,
      bucketIds: cachePlan.buckets.map((bucket) => bucket.id),
    });
  } catch (error) {
    logger.warn(
      { err: error, projectId: plan.input.projectId },
      'Report cache read failed; falling back to raw query'
    );
    return fetchRaw(plan, options);
  }

  const chunks: ConcreteSeries[][] = [];
  for (const bucket of cachePlan.buckets) {
    const cachedBucket = cached.get(bucket.id);
    if (cachedBucket) {
      chunks.push(cachedBucket);
    }
  }

  const missingGroups = groupConsecutiveMissingBuckets(
    cachePlan.buckets,
    cached
  );

  for (const group of missingGroups) {
    const first = group[0]!;
    const last = group.at(-1)!;
    const fetched = await fetchRange(
      plan,
      {
        startDate: first.startDate,
        endDate: last.endDate,
      },
      options
    );
    chunks.push(fetched);

    if (!options?.abortSignal?.aborted) {
      try {
        await setReportCacheEntries({
          projectId: plan.input.projectId,
          cacheKey,
          timezone: plan.timezone,
          interval: plan.input.interval,
          entries: splitSeriesIntoBucketPayloads({
            series: fetched,
            buckets: group,
            interval: plan.input.interval,
            timezone: plan.timezone,
          }),
        });
      } catch (error) {
        logger.warn(
          { err: error, projectId: plan.input.projectId },
          'Report cache write failed'
        );
      }
    }
  }

  for (const range of cachePlan.rawRanges) {
    chunks.push(await fetchRange(plan, range, options));
  }

  return mergeConcreteSeriesChunks(chunks);
}
