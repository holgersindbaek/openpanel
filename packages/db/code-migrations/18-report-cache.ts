import fs from 'node:fs';
import path from 'node:path';
import { TABLE_NAMES } from '../src/clickhouse/client';
import {
  createTable,
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
    !existingTables.includes(`${TABLE_NAMES.report_cache}_distributed`) &&
    !existingTables.includes(TABLE_NAMES.report_cache)
  ) {
    sqls.push(
      ...createTable({
        name: TABLE_NAMES.report_cache,
        columns: [
          '`project_id` String CODEC(ZSTD(3))',
          '`cache_key` String CODEC(ZSTD(3))',
          '`timezone` LowCardinality(String)',
          '`interval` LowCardinality(String)',
          '`bucket_id` String CODEC(ZSTD(3))',
          '`bucket_start` DateTime',
          '`bucket_end` DateTime',
          '`payload` String CODEC(ZSTD(6))',
          '`version` UInt32 DEFAULT 1',
          '`computed_at` DateTime DEFAULT now()',
        ],
        engine: 'ReplacingMergeTree(computed_at)',
        orderBy: [
          'project_id',
          'cache_key',
          'version',
          'timezone',
          'interval',
          'bucket_id',
        ],
        partitionBy: 'toYYYYMM(bucket_start)',
        settings: {
          index_granularity: 8192,
        },
        distributionHash: 'cityHash64(project_id, cache_key)',
        replicatedVersion,
        isClustered,
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
    dropTable(`${TABLE_NAMES.report_cache}_distributed`, isClustered),
    dropTable(`${TABLE_NAMES.report_cache}_replicated`, isClustered),
    dropTable(TABLE_NAMES.report_cache, isClustered),
  ];

  await runClickhouseMigrationCommands(sqls);
}
