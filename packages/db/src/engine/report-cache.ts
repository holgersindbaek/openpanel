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
import { logReportDebug, type ReportDebugContext } from './report-debug';
import type { ConcreteSeries, Plan } from './types';

const logger = createLogger({ name: 'report-cache-engine' });

interface FetchOptions {
  abortSignal?: AbortSignal;
  debugContext?: ReportDebugContext;
}

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
  options: FetchOptions | undefined,
  source: 'cache-miss' | 'raw-range' | 'cache-disabled' | 'ineligible'
) {
  const startedAt = Date.now();
  logReportDebug(logger, 'cache.raw_fetch.start', options?.debugContext, {
    source,
    startDate: range.startDate,
    endDate: range.endDate,
  });

  try {
    const result = await fetchRaw(
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
    logReportDebug(logger, 'cache.raw_fetch.done', options?.debugContext, {
      source,
      startDate: range.startDate,
      endDate: range.endDate,
      elapsedMs: Date.now() - startedAt,
      series: result.length,
    });
    return result;
  } catch (error) {
    logReportDebug(
      logger,
      'cache.raw_fetch.error',
      options?.debugContext,
      {
        source,
        startDate: range.startDate,
        endDate: range.endDate,
        elapsedMs: Date.now() - startedAt,
        err: error,
      },
      'error'
    );
    throw error;
  }
}

export async function fetchWithReportCache(
  plan: Plan,
  options?: FetchOptions
): Promise<ConcreteSeries[]> {
  if (process.env.REPORT_CACHE_DISABLED === 'true') {
    logReportDebug(logger, 'cache.disabled', options?.debugContext);
    return fetchRange(
      plan,
      {
        startDate: plan.input.startDate,
        endDate: plan.input.endDate,
      },
      options,
      'cache-disabled'
    );
  }

  const ineligibilityReason = getReportCacheIneligibilityReason(plan.input);
  if (ineligibilityReason) {
    logReportDebug(logger, 'cache.ineligible', options?.debugContext, {
      reason: ineligibilityReason,
    });
    return fetchRange(
      plan,
      {
        startDate: plan.input.startDate,
        endDate: plan.input.endDate,
      },
      options,
      'ineligible'
    );
  }

  if (!isCacheableReportInterval(plan.input.interval)) {
    logReportDebug(logger, 'cache.ineligible', options?.debugContext, {
      reason: 'interval',
    });
    return fetchRange(
      plan,
      {
        startDate: plan.input.startDate,
        endDate: plan.input.endDate,
      },
      options,
      'ineligible'
    );
  }

  const cachePlan = getClosedReportCacheBuckets({
    startDate: plan.input.startDate,
    endDate: plan.input.endDate,
    interval: plan.input.interval,
    timezone: plan.timezone,
  });

  if (cachePlan.buckets.length === 0) {
    logReportDebug(logger, 'cache.no_closed_buckets', options?.debugContext, {
      rawRanges: cachePlan.rawRanges.length,
    });
    return fetchRange(
      plan,
      {
        startDate: plan.input.startDate,
        endDate: plan.input.endDate,
      },
      options,
      'ineligible'
    );
  }

  const cacheKey = getReportCacheKey(plan.input, plan.timezone);
  let cached = new Map<string, ConcreteSeries[]>();
  const cacheReadStartedAt = Date.now();
  logReportDebug(logger, 'cache.plan', options?.debugContext, {
    interval: plan.input.interval,
    buckets: cachePlan.buckets.length,
    rawRanges: cachePlan.rawRanges.length,
  });

  try {
    cached = await getReportCacheEntries<ConcreteSeries[]>({
      projectId: plan.input.projectId,
      cacheKey,
      bucketIds: cachePlan.buckets.map((bucket) => bucket.id),
    });
    logReportDebug(logger, 'cache.read.done', options?.debugContext, {
      elapsedMs: Date.now() - cacheReadStartedAt,
      requestedBuckets: cachePlan.buckets.length,
      hits: cached.size,
      misses: cachePlan.buckets.length - cached.size,
    });
  } catch (error) {
    logger.warn(
      { err: error, projectId: plan.input.projectId },
      'Report cache read failed; falling back to raw query'
    );
    logReportDebug(
      logger,
      'cache.read.error',
      options?.debugContext,
      {
        elapsedMs: Date.now() - cacheReadStartedAt,
        err: error,
      },
      'warn'
    );
    return fetchRange(
      plan,
      {
        startDate: plan.input.startDate,
        endDate: plan.input.endDate,
      },
      options,
      'ineligible'
    );
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
      options,
      'cache-miss'
    );
    chunks.push(fetched);

    if (!options?.abortSignal?.aborted) {
      try {
        const writeStartedAt = Date.now();
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
        logReportDebug(logger, 'cache.write.done', options?.debugContext, {
          elapsedMs: Date.now() - writeStartedAt,
          buckets: group.length,
        });
      } catch (error) {
        logger.warn(
          { err: error, projectId: plan.input.projectId },
          'Report cache write failed'
        );
        logReportDebug(
          logger,
          'cache.write.error',
          options?.debugContext,
          {
            buckets: group.length,
            err: error,
          },
          'warn'
        );
      }
    }
  }

  for (const range of cachePlan.rawRanges) {
    chunks.push(await fetchRange(plan, range, options, 'raw-range'));
  }

  const merged = mergeConcreteSeriesChunks(chunks);
  logReportDebug(logger, 'cache.done', options?.debugContext, {
    chunks: chunks.length,
    mergedSeries: merged.length,
  });
  return merged;
}
