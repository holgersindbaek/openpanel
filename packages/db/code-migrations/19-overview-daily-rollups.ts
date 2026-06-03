import fs from 'node:fs';
import path from 'node:path';
import { TABLE_NAMES } from '../src/clickhouse/client';
import {
  createMaterializedView,
  dropTable,
  getExistingTables,
  runClickhouseMigrationCommands,
} from '../src/clickhouse/migration';
import { getIsCluster } from './helpers';

export async function up() {
  const replicatedVersion = '1';
  const existingTables = await getExistingTables();
  const isClustered = getIsCluster();

  const sqls: string[] = [];

  if (
    !existingTables.includes(
      `${TABLE_NAMES.overview_sessions_daily_mv}_distributed`
    ) &&
    !existingTables.includes(TABLE_NAMES.overview_sessions_daily_mv)
  ) {
    sqls.push(
      ...createMaterializedView({
        name: TABLE_NAMES.overview_sessions_daily_mv,
        tableName: TABLE_NAMES.sessions,
        engine: 'SummingMergeTree()',
        orderBy: ['project_id', 'date'],
        partitionBy: 'toYYYYMM(date)',
        query: `SELECT
          project_id,
          toDate(created_at) AS date,
          sum(toInt64(sign)) AS total_sessions,
          sum(toInt64(sign) * toInt64(is_bounce)) AS bounced_sessions,
          sum(toInt64(sign) * toInt64(screen_view_count)) AS total_screen_views,
          sum(if(duration > 0 AND sign > 0, toUInt64(duration), toUInt64(0))) AS duration_sum,
          sum(if(duration > 0 AND sign > 0, toUInt64(1), toUInt64(0))) AS duration_count
        FROM {sessions}
        GROUP BY project_id, date`,
        distributionHash: 'cityHash64(project_id, date)',
        replicatedVersion,
        isClustered,
        populate: false,
      })
    );
  }

  if (
    !existingTables.includes(
      `${TABLE_NAMES.overview_profiles_daily_mv}_distributed`
    ) &&
    !existingTables.includes(TABLE_NAMES.overview_profiles_daily_mv)
  ) {
    sqls.push(
      ...createMaterializedView({
        name: TABLE_NAMES.overview_profiles_daily_mv,
        tableName: TABLE_NAMES.sessions,
        engine: 'SummingMergeTree()',
        orderBy: ['project_id', 'date', 'profile_id'],
        partitionBy: 'toYYYYMM(date)',
        query: `SELECT
          project_id,
          toDate(created_at) AS date,
          profile_id,
          sum(toInt64(sign > 0)) AS activity
        FROM {sessions}
        WHERE profile_id != ''
        GROUP BY project_id, date, profile_id`,
        distributionHash: 'cityHash64(project_id, profile_id)',
        replicatedVersion,
        isClustered,
        populate: false,
      })
    );
  }

  if (
    !existingTables.includes(
      `${TABLE_NAMES.overview_revenue_daily_mv}_distributed`
    ) &&
    !existingTables.includes(TABLE_NAMES.overview_revenue_daily_mv)
  ) {
    sqls.push(
      ...createMaterializedView({
        name: TABLE_NAMES.overview_revenue_daily_mv,
        tableName: TABLE_NAMES.events,
        engine: 'SummingMergeTree()',
        orderBy: ['project_id', 'date'],
        partitionBy: 'toYYYYMM(date)',
        query: `SELECT
          project_id,
          toDate(created_at) AS date,
          sum(revenue) AS total_revenue
        FROM {events}
        WHERE name = 'revenue'
          AND revenue > 0
        GROUP BY project_id, date`,
        distributionHash: 'cityHash64(project_id, date)',
        replicatedVersion,
        isClustered,
        populate: false,
      })
    );
  }

  fs.writeFileSync(
    path.join(import.meta.filename.replace('.ts', '.sql')),
    sqls
      .map((sql) =>
        sql
          .trim()
          .replace(/;$/, '')
          .replace(/\n{2,}/g, '\n')
          .concat(';')
      )
      .join('\n\n---\n\n')
  );

  if (!process.argv.includes('--dry')) {
    await runClickhouseMigrationCommands(sqls);
  }
}

export async function down() {
  const isClustered = getIsCluster();

  const sqls = [
    dropTable(
      `${TABLE_NAMES.overview_revenue_daily_mv}_distributed`,
      isClustered
    ),
    dropTable(
      `${TABLE_NAMES.overview_revenue_daily_mv}_replicated`,
      isClustered
    ),
    dropTable(TABLE_NAMES.overview_revenue_daily_mv, isClustered),
    dropTable(
      `${TABLE_NAMES.overview_profiles_daily_mv}_distributed`,
      isClustered
    ),
    dropTable(
      `${TABLE_NAMES.overview_profiles_daily_mv}_replicated`,
      isClustered
    ),
    dropTable(TABLE_NAMES.overview_profiles_daily_mv, isClustered),
    dropTable(
      `${TABLE_NAMES.overview_sessions_daily_mv}_distributed`,
      isClustered
    ),
    dropTable(
      `${TABLE_NAMES.overview_sessions_daily_mv}_replicated`,
      isClustered
    ),
    dropTable(TABLE_NAMES.overview_sessions_daily_mv, isClustered),
  ];

  await runClickhouseMigrationCommands(sqls);
}
