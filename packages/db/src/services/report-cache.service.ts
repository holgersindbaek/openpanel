import crypto from 'node:crypto';
import { createLogger } from '@openpanel/logger';
import type {
  IChartEventFilter,
  IChartEventItem,
  IReportInputWithDates,
} from '@openpanel/validation';
import sqlstring from 'sqlstring';
import {
  ch,
  chQuery,
  getReplicatedTableName,
  TABLE_NAMES,
} from '../clickhouse/client';
import type { CacheableReportInterval } from './date.service';

const logger = createLogger({ name: 'report-cache' });

export const REPORT_CACHE_VERSION = 1;

function readPositiveIntEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const REPORT_CACHE_BREAKDOWN_VALUE_LIMIT = readPositiveIntEnv(
  'REPORT_CACHE_BREAKDOWN_VALUE_LIMIT',
  200
);
export const REPORT_CACHE_MAX_BUCKET_SERIES = readPositiveIntEnv(
  'REPORT_CACHE_MAX_BUCKET_SERIES',
  250
);
export const REPORT_CACHE_MAX_BUCKET_PAYLOAD_BYTES = readPositiveIntEnv(
  'REPORT_CACHE_MAX_BUCKET_PAYLOAD_BYTES',
  1_000_000
);

const CACHEABLE_INTERVALS = new Set<string>(['day', 'week', 'month']);
const CACHEABLE_SEGMENTS = new Set<string>([
  'event',
  'user',
  'session',
  'user_average',
  'property_sum',
  'property_average',
  'property_min',
  'property_max',
]);

export interface ReportCacheEntry<TPayload> {
  bucketId: string;
  bucketStart: string;
  bucketEnd: string;
  payload: TPayload;
}

export function isCacheableReportInterval(
  interval: string
): interval is CacheableReportInterval {
  return CACHEABLE_INTERVALS.has(interval);
}

function hasDynamicFilter(filters: IChartEventFilter[]) {
  return filters.some((filter) => {
    if (filter.operator === 'inCohort' || filter.operator === 'notInCohort') {
      return true;
    }
    return (
      filter.name === 'cohort' ||
      filter.name.startsWith('cohort:') ||
      filter.name.startsWith('profile.') ||
      filter.name.startsWith('group.')
    );
  });
}

function getEventDefinitions(input: IReportInputWithDates) {
  return input.series.filter(
    (item): item is IChartEventItem & { type: 'event' } => item.type === 'event'
  );
}

export function getReportCacheBreakdownIneligibilityReason(
  input: IReportInputWithDates
): string | null {
  if (input.breakdowns.length === 0) {
    return null;
  }

  if (input.breakdowns.length > 1) {
    return 'breakdowns:multiple';
  }

  const breakdownName = input.breakdowns[0]?.name;
  if (!breakdownName?.startsWith('properties.')) {
    return 'breakdowns:field';
  }

  const propertyKey = breakdownName.replace(/^properties\./, '');
  if (!(propertyKey && !propertyKey.includes('*'))) {
    return 'breakdowns:wildcard';
  }

  return null;
}

export function getReportCacheIneligibilityReason(
  input: IReportInputWithDates
): string | null {
  if (!isCacheableReportInterval(input.interval)) {
    return 'interval';
  }

  if (input.includeTotalCount) {
    return 'total-count';
  }

  const breakdownReason = getReportCacheBreakdownIneligibilityReason(input);
  if (breakdownReason) {
    return breakdownReason;
  }

  if (input.offset) {
    return 'pagination';
  }

  for (const event of getEventDefinitions(input)) {
    if (!CACHEABLE_SEGMENTS.has(event.segment)) {
      return `segment:${event.segment}`;
    }

    if (hasDynamicFilter(event.filters)) {
      return 'dynamic-filter';
    }

    if (
      event.property &&
      (event.property.startsWith('profile.') ||
        event.property.startsWith('group.') ||
        event.property === 'cohort' ||
        event.property.startsWith('cohort:'))
    ) {
      return 'dynamic-property';
    }
  }

  return null;
}

export async function getReportCacheRuntimeIneligibilityReason(
  input: IReportInputWithDates,
  options?: { abortSignal?: AbortSignal }
): Promise<string | null> {
  if (input.breakdowns.length === 0) {
    return null;
  }

  const breakdownName = input.breakdowns[0]?.name;
  if (!breakdownName) {
    return 'breakdowns:missing';
  }

  const propertyKey = breakdownName.replace(/^properties\./, '');
  const eventNames = [
    ...new Set(
      getEventDefinitions(input)
        .map((event) => event.name)
        .filter((name) => name && name !== '*')
    ),
  ];
  const limit = Math.max(1, REPORT_CACHE_BREAKDOWN_VALUE_LIMIT);
  const rows = await chQuery<{ value_count: number }>(
    `SELECT count() AS value_count
    FROM (
      SELECT property_value
      FROM ${TABLE_NAMES.event_property_values_mv}
      WHERE project_id = ${sqlstring.escape(input.projectId)}
        AND property_key = ${sqlstring.escape(propertyKey)}
        ${
          eventNames.length > 0
            ? `AND name IN (${eventNames.map((name) => sqlstring.escape(name)).join(',')})`
            : ''
        }
      GROUP BY property_value
      LIMIT ${limit + 1}
    )`,
    undefined,
    options?.abortSignal ? { abortSignal: options.abortSignal } : undefined
  );
  const valueCount = Number(rows[0]?.value_count ?? 0);

  if (valueCount > limit) {
    return `breakdowns:cardinality:${valueCount}`;
  }

  return null;
}

export function getReportCacheWriteSkipReason<TPayload>({
  entries,
}: {
  entries: ReportCacheEntry<TPayload>[];
}): {
  reason: 'max-series' | 'max-payload';
  bucketId: string;
  actual: number;
  limit: number;
} | null {
  for (const entry of entries) {
    const seriesCount = Array.isArray(entry.payload) ? entry.payload.length : 0;
    if (seriesCount > REPORT_CACHE_MAX_BUCKET_SERIES) {
      return {
        reason: 'max-series',
        bucketId: entry.bucketId,
        actual: seriesCount,
        limit: REPORT_CACHE_MAX_BUCKET_SERIES,
      };
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(entry.payload));
    if (payloadBytes > REPORT_CACHE_MAX_BUCKET_PAYLOAD_BYTES) {
      return {
        reason: 'max-payload',
        bucketId: entry.bucketId,
        actual: payloadBytes,
        limit: REPORT_CACHE_MAX_BUCKET_PAYLOAD_BYTES,
      };
    }
  }

  return null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        out[key] = stableValue(item);
      }
    }
    return out;
  }

  return value;
}

export function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function getReportCacheKey(
  input: IReportInputWithDates,
  timezone: string
) {
  const keyInput = {
    version: REPORT_CACHE_VERSION,
    projectId: input.projectId,
    timezone,
    interval: input.interval,
    chartType: input.chartType,
    metric: input.metric,
    includeTotalCount: input.includeTotalCount ?? false,
    series: input.series,
    breakdowns: input.breakdowns,
  };

  return crypto
    .createHash('sha256')
    .update(stableStringify(keyInput))
    .digest('hex');
}

export async function getReportCacheEntries<TPayload>({
  projectId,
  cacheKey,
  bucketIds,
}: {
  projectId: string;
  cacheKey: string;
  bucketIds: string[];
}): Promise<Map<string, TPayload>> {
  const entries = new Map<string, TPayload>();
  if (bucketIds.length === 0) {
    return entries;
  }

  const rows = await chQuery<{ bucket_id: string; payload: string }>(
    `SELECT
      bucket_id,
      argMax(payload, computed_at) AS payload
    FROM ${TABLE_NAMES.report_cache}
    WHERE project_id = ${sqlstring.escape(projectId)}
      AND cache_key = ${sqlstring.escape(cacheKey)}
      AND version = ${REPORT_CACHE_VERSION}
      AND bucket_id IN (${bucketIds.map((id) => sqlstring.escape(id)).join(',')})
    GROUP BY bucket_id`
  );

  for (const row of rows) {
    try {
      entries.set(row.bucket_id, JSON.parse(row.payload) as TPayload);
    } catch (error) {
      logger.warn(
        { err: error, bucketId: row.bucket_id },
        'Failed to parse report cache payload'
      );
    }
  }

  return entries;
}

export async function setReportCacheEntries<TPayload>({
  projectId,
  cacheKey,
  timezone,
  interval,
  entries,
}: {
  projectId: string;
  cacheKey: string;
  timezone: string;
  interval: CacheableReportInterval;
  entries: ReportCacheEntry<TPayload>[];
}) {
  if (entries.length === 0) {
    return;
  }

  await ch.insert({
    table: TABLE_NAMES.report_cache,
    values: entries.map((entry) => ({
      project_id: projectId,
      cache_key: cacheKey,
      timezone,
      interval,
      bucket_id: entry.bucketId,
      bucket_start: entry.bucketStart,
      bucket_end: entry.bucketEnd,
      payload: JSON.stringify(entry.payload),
      version: REPORT_CACHE_VERSION,
    })),
    format: 'JSONEachRow',
  });
}

export async function clearReportCacheForProjects(projectIds: string[]) {
  if (projectIds.length === 0) {
    return;
  }

  try {
    await ch.command({
      query: `DELETE FROM ${getReplicatedTableName(TABLE_NAMES.report_cache)}
WHERE project_id IN (${projectIds.map((id) => sqlstring.escape(id)).join(',')})`,
      clickhouse_settings: {
        lightweight_deletes_sync: '0',
      },
    });
  } catch (error) {
    logger.warn(
      { err: error, projectIds },
      'Failed to clear report cache for projects'
    );
  }
}
