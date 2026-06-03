import { getReplicatedTableName, TABLE_NAMES } from '../src/clickhouse/client';
import {
  chMigrationClient,
  runClickhouseMigrationCommands,
} from '../src/clickhouse/migration';
import { getIsCluster } from './helpers';

type Batch = { start: string; end: string };

function formatChDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function formatChDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseChDateTime(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function resolveTargetTable(baseName: string, isClustered: boolean): string {
  return isClustered ? `${baseName}_replicated` : baseName;
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  );
}

function makeMonthlyBatches(
  min: Date,
  max: Date,
  batchMonths: number
): Batch[] {
  const batches: Batch[] = [];
  let cursor = startOfUtcMonth(min);
  const end = addUtcMonths(startOfUtcMonth(max), 1);

  while (cursor < end) {
    const next = addUtcMonths(cursor, batchMonths);
    const batchEnd = next > end ? end : next;
    batches.push({
      start: formatChDateTime(cursor),
      end: formatChDateTime(batchEnd),
    });
    cursor = batchEnd;
  }

  return batches;
}

async function getBounds(
  table: string
): Promise<{ min: Date; max: Date } | null> {
  const res = await chMigrationClient.query({
    query: `
      SELECT min(created_at) AS min, max(created_at) AS max
      FROM ${table}
    `,
    format: 'JSONEachRow',
  });
  const rows = (await res.json()) as Array<{
    min: string | null;
    max: string | null;
  }>;
  const min = rows[0]?.min;
  const max = rows[0]?.max;
  if (!min || !max) {
    return null;
  }
  return {
    min: parseChDateTime(min),
    max: parseChDateTime(max),
  };
}

function deleteRangeSql(table: string, batch: Batch) {
  return `ALTER TABLE ${getReplicatedTableName(table)} DELETE
WHERE date >= toDate('${formatChDate(parseChDateTime(batch.start))}')
  AND date < toDate('${formatChDate(parseChDateTime(batch.end))}')`;
}

function sessionsSql(targetTable: string, batch: Batch) {
  return `INSERT INTO ${targetTable}
SELECT
  project_id,
  toDate(created_at) AS date,
  sum(toInt64(sign)) AS total_sessions,
  sum(toInt64(sign) * toInt64(is_bounce)) AS bounced_sessions,
  sum(toInt64(sign) * toInt64(screen_view_count)) AS total_screen_views,
  sum(if(duration > 0 AND sign > 0, toUInt64(duration), toUInt64(0))) AS duration_sum,
  sum(if(duration > 0 AND sign > 0, toUInt64(1), toUInt64(0))) AS duration_count
FROM ${TABLE_NAMES.sessions}
WHERE created_at >= toDateTime('${batch.start}')
  AND created_at < toDateTime('${batch.end}')
GROUP BY project_id, date`;
}

function profilesSql(targetTable: string, batch: Batch) {
  return `INSERT INTO ${targetTable}
SELECT
  project_id,
  toDate(created_at) AS date,
  profile_id,
  sum(toInt64(sign > 0)) AS activity
FROM ${TABLE_NAMES.sessions}
WHERE created_at >= toDateTime('${batch.start}')
  AND created_at < toDateTime('${batch.end}')
  AND profile_id != ''
GROUP BY project_id, date, profile_id`;
}

function revenueSql(targetTable: string, batch: Batch) {
  return `INSERT INTO ${targetTable}
SELECT
  project_id,
  toDate(created_at) AS date,
  sum(revenue) AS total_revenue
FROM ${TABLE_NAMES.events}
WHERE created_at >= toDateTime('${batch.start}')
  AND created_at < toDateTime('${batch.end}')
  AND name = 'revenue'
  AND revenue > 0
GROUP BY project_id, date`;
}

async function runBatches(
  label: string,
  table: string,
  batches: Batch[],
  getInsertSql: (batch: Batch) => string
) {
  console.log('');
  console.log(`${label}: backfilling ${batches.length} monthly batch(es)`);

  for (const [index, batch] of batches.entries()) {
    await runClickhouseMigrationCommands([
      deleteRangeSql(table, batch),
      getInsertSql(batch),
    ]);
    console.log(
      `${label}: ${index + 1}/${batches.length} ${batch.start} -> ${batch.end}`
    );
  }
}

export async function up() {
  const isClustered = getIsCluster();
  const isDryRun = process.argv.includes('--dry');
  const batchMonths = Math.max(
    1,
    Number.parseInt(getArg('batch-months') ?? '1', 10)
  );

  const sessionsBounds = await getBounds(TABLE_NAMES.sessions);
  const eventsBounds = await getBounds(TABLE_NAMES.events);

  const sessionBatches = sessionsBounds
    ? makeMonthlyBatches(sessionsBounds.min, sessionsBounds.max, batchMonths)
    : [];
  const revenueBatches = eventsBounds
    ? makeMonthlyBatches(eventsBounds.min, eventsBounds.max, batchMonths)
    : [];

  const sessionsTarget = resolveTargetTable(
    TABLE_NAMES.overview_sessions_daily_mv,
    isClustered
  );
  const profilesTarget = resolveTargetTable(
    TABLE_NAMES.overview_profiles_daily_mv,
    isClustered
  );
  const revenueTarget = resolveTargetTable(
    TABLE_NAMES.overview_revenue_daily_mv,
    isClustered
  );

  console.log('');
  console.log('Overview daily rollup backfill');
  console.log(`Clustered: ${isClustered}`);
  console.log(`Batch size: ${batchMonths} month(s)`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'EXECUTE'}`);

  if (isDryRun) {
    console.log('');
    console.log(
      sessionsSql(
        sessionsTarget,
        sessionBatches[0] ?? {
          start: '1970-01-01 00:00:00',
          end: '1970-02-01 00:00:00',
        }
      )
    );
    console.log('');
    console.log(
      profilesSql(
        profilesTarget,
        sessionBatches[0] ?? {
          start: '1970-01-01 00:00:00',
          end: '1970-02-01 00:00:00',
        }
      )
    );
    console.log('');
    console.log(
      revenueSql(
        revenueTarget,
        revenueBatches[0] ?? {
          start: '1970-01-01 00:00:00',
          end: '1970-02-01 00:00:00',
        }
      )
    );
    return;
  }

  if (sessionBatches.length > 0) {
    await runBatches(
      'overview_sessions_daily_mv',
      TABLE_NAMES.overview_sessions_daily_mv,
      sessionBatches,
      (batch) => sessionsSql(sessionsTarget, batch)
    );
    await runBatches(
      'overview_profiles_daily_mv',
      TABLE_NAMES.overview_profiles_daily_mv,
      sessionBatches,
      (batch) => profilesSql(profilesTarget, batch)
    );
  }

  if (revenueBatches.length > 0) {
    await runBatches(
      'overview_revenue_daily_mv',
      TABLE_NAMES.overview_revenue_daily_mv,
      revenueBatches,
      (batch) => revenueSql(revenueTarget, batch)
    );
  }
}

export async function down() {
  // Backfill-only migration. The rollup tables are dropped by
  // 19-overview-daily-rollups.ts.
}
