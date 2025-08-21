import { escape } from 'sqlstring';

import { stripLeadingAndTrailingSlashes } from '@openpanel/common';
import type {
  IChartEventFilter,
  IGetChartDataInput,
} from '@openpanel/validation';

import { TABLE_NAMES, formatClickhouseDate } from '../clickhouse/client';
import { createSqlBuilder } from '../sql-builder';

export function transformPropertyKey(property: string) {
  const propertyPatterns = ['properties', 'profile.properties'];
  const match = propertyPatterns.find((pattern) =>
    property.startsWith(`${pattern}.`),
  );

  if (!match) {
    return property;
  }

  if (property.includes('*')) {
    return property
      .replace(/^properties\./, '')
      .replace('.*.', '.%.')
      .replace(/\[\*\]$/, '.%')
      .replace(/\[\*\].?/, '.%.');
  }

  return `${match}['${property.replace(new RegExp(`^${match}.`), '')}']`;
}

function isNumericProperty(property: string): boolean {
  // List of known numeric fields in the events table
  const numericFields = ['duration', 'created_at', 'timestamp'];
  return numericFields.includes(property);
}

export function getSelectPropertyKey(property: string) {
  if (property === 'has_profile') {
    return `if(profile_id != device_id, 'true', 'false')`;
  }

  const propertyPatterns = ['properties', 'profile.properties'];

  const match = propertyPatterns.find((pattern) =>
    property.startsWith(`${pattern}.`),
  );
  if (!match) return property;

  if (property.includes('*')) {
    return `arrayMap(x -> trim(x), mapValues(mapExtractKeyLike(${match}, ${escape(
      transformPropertyKey(property),
    )})))`;
  }

  return `${match}['${property.replace(new RegExp(`^${match}.`), '')}']`;
}

export function getChartSql({
  event,
  breakdowns,
  interval,
  startDate,
  endDate,
  projectId,
  limit,
  timezone,
}: IGetChartDataInput & { timezone: string }) {
  const {
    sb,
    join,
    getWhere,
    getFrom,
    getJoins,
    getSelect,
    getOrderBy,
    getGroupBy,
  } = createSqlBuilder();

  sb.where = getEventFiltersWhereClause(event.filters);
  sb.where.projectId = `project_id = ${escape(projectId)}`;

  if (event.name !== '*') {
    sb.select.label_0 = `${escape(event.name)} as label_0`;
    sb.where.eventName = `name = ${escape(event.name)}`;
  } else {
    sb.select.label_0 = `'*' as label_0`;
  }

  const anyFilterOnProfile = event.filters.some((filter) =>
    filter.name.startsWith('profile.'),
  );
  const anyBreakdownOnProfile = breakdowns.some((breakdown) =>
    breakdown.name.startsWith('profile.'),
  );

  if (anyFilterOnProfile || anyBreakdownOnProfile) {
    sb.joins.profiles = `LEFT ANY JOIN (SELECT 
      id as "profile.id",
      email as "profile.email",
      first_name as "profile.first_name",
      last_name as "profile.last_name",
      properties as "profile.properties"
    FROM ${TABLE_NAMES.profiles} FINAL WHERE project_id = ${escape(projectId)}) as profile on profile.id = profile_id`;
  }

  sb.select.count = 'count(*) as count';
  switch (interval) {
    case 'minute': {
      sb.orderBy.date = `date ASC WITH FILL FROM toStartOfMinute(toDateTime('${startDate}')) TO toStartOfMinute(toDateTime('${endDate}')) STEP toIntervalMinute(1)`;
      sb.select.date = 'toStartOfMinute(created_at) as date';
      break;
    }
    case 'hour': {
      sb.orderBy.date = `date ASC WITH FILL FROM toStartOfHour(toDateTime('${startDate}')) TO toStartOfHour(toDateTime('${endDate}')) STEP toIntervalHour(1)`;
      sb.select.date = 'toStartOfHour(created_at) as date';
      break;
    }
    case 'day': {
      sb.orderBy.date = `date ASC WITH FILL FROM toStartOfDay(toDateTime('${startDate}')) TO toStartOfDay(toDateTime('${endDate}')) STEP toIntervalDay(1)`;
      sb.select.date = 'toStartOfDay(created_at) as date';
      break;
    }
    case 'week': {
      sb.orderBy.date = `date ASC WITH FILL FROM toStartOfWeek(toDateTime('${startDate}'), 1, '${timezone}') TO toStartOfWeek(toDateTime('${endDate}'), 1, '${timezone}') STEP toIntervalWeek(1)`;
      sb.select.date = `toStartOfWeek(created_at, 1, '${timezone}') as date`;
      break;
    }
    case 'month': {
      sb.orderBy.date = `date ASC WITH FILL FROM toStartOfMonth(toDateTime('${startDate}'), '${timezone}') TO toStartOfMonth(toDateTime('${endDate}'), '${timezone}') STEP toIntervalMonth(1)`;
      sb.select.date = `toStartOfMonth(created_at, '${timezone}') as date`;
      break;
    }
  }
  sb.groupBy.date = 'date';
  if (!sb.orderBy.date) {
    sb.orderBy.date = 'date ASC';
  }

  if (startDate) {
    sb.where.startDate = `created_at >= toDateTime('${formatClickhouseDate(startDate)}')`;
  }

  if (endDate) {
    sb.where.endDate = `created_at <= toDateTime('${formatClickhouseDate(endDate)}')`;
  }

  if (breakdowns.length > 0 && limit) {
    sb.where.bar = `(${breakdowns.map((b) => getSelectPropertyKey(b.name)).join(',')}) IN (
      SELECT ${breakdowns.map((b) => getSelectPropertyKey(b.name)).join(',')}
      FROM ${TABLE_NAMES.events}
      ${getJoins()}
      ${getWhere()}
      GROUP BY ${breakdowns.map((b) => getSelectPropertyKey(b.name)).join(',')}
      ORDER BY count(*) DESC
      LIMIT ${limit}
    )`;
  }

  breakdowns.forEach((breakdown, index) => {
    const key = `label_${index}`;
    sb.select[key] = `${getSelectPropertyKey(breakdown.name)} as ${key}`;
    sb.groupBy[key] = `${key}`;
  });

  if (event.segment === 'user') {
    sb.select.count = 'countDistinct(profile_id) as count';
  }

  if (event.segment === 'session') {
    sb.select.count = 'countDistinct(session_id) as count';
  }

  if (event.segment === 'user_average') {
    sb.select.count =
      'COUNT(*)::float / COUNT(DISTINCT profile_id)::float as count';
  }

  if (event.segment === 'property_sum' && event.property) {
    const propertyKey = getSelectPropertyKey(event.property);
    sb.select.count = `sum(toFloat64(${propertyKey})) as count`;
    if (isNumericProperty(event.property)) {
      sb.where.property = `${propertyKey} IS NOT NULL`;
    } else {
      sb.where.property = `${propertyKey} IS NOT NULL AND notEmpty(${propertyKey})`;
    }
  }

  if (event.segment === 'property_average' && event.property) {
    const propertyKey = getSelectPropertyKey(event.property);
    sb.select.count = `avg(toFloat64(${propertyKey})) as count`;
    if (isNumericProperty(event.property)) {
      sb.where.property = `${propertyKey} IS NOT NULL`;
    } else {
      sb.where.property = `${propertyKey} IS NOT NULL AND notEmpty(${propertyKey})`;
    }
  }

  if (event.segment === 'property_max' && event.property) {
    const propertyKey = getSelectPropertyKey(event.property);
    sb.select.count = `max(toFloat64(${propertyKey})) as count`;
    if (isNumericProperty(event.property)) {
      sb.where.property = `${propertyKey} IS NOT NULL`;
    } else {
      sb.where.property = `${propertyKey} IS NOT NULL AND notEmpty(${propertyKey})`;
    }
  }

  if (event.segment === 'property_min' && event.property) {
    const propertyKey = getSelectPropertyKey(event.property);
    sb.select.count = `min(toFloat64(${propertyKey})) as count`;
    if (isNumericProperty(event.property)) {
      sb.where.property = `${propertyKey} IS NOT NULL`;
    } else {
      sb.where.property = `${propertyKey} IS NOT NULL AND notEmpty(${propertyKey})`;
    }
  }

  if (event.segment === 'one_event_per_user') {
    sb.from = `(
      SELECT DISTINCT ON (profile_id) * from ${TABLE_NAMES.events} ${getJoins()} WHERE ${join(
        sb.where,
        ' AND ',
      )}
        ORDER BY profile_id, created_at DESC
      ) as subQuery`;
    sb.joins = {};

    const sql = `${getSelect()} ${getFrom()} ${getJoins()} ${getWhere()} ${getGroupBy()} ${getOrderBy()}`;
    console.log('-- Report --');
    console.log(sql.replaceAll(/[\n\r]/g, ' '));
    console.log('-- End --');
    return sql;
  }

  const sql = `${getSelect()} ${getFrom()} ${getJoins()} ${getWhere()} ${getGroupBy()} ${getOrderBy()}`;
  console.log('-- Report --');
  console.log(sql.replaceAll(/[\n\r]/g, ' '));
  console.log('-- End --');
  return sql;
}

export function getEventFiltersWhereClause(filters: IChartEventFilter[]) {
  const where: Record<string, string> = {};
  filters.forEach((filter, index) => {
    const id = `f${index}`;
    const { name, value, operator } = filter;

    if (
      value.length === 0 &&
      operator !== 'isNull' &&
      operator !== 'isNotNull'
    ) {
      return;
    }

    if (name === 'has_profile') {
      if (value.includes('true')) {
        where[id] = 'profile_id != device_id';
      } else {
        where[id] = 'profile_id = device_id';
      }
      return;
    }

    // Handle duration filtering (convert seconds to milliseconds)
    if (name === 'duration') {
      switch (operator) {
        case 'greaterThan': {
          where[id] = `duration > ${Number(value[0]) * 1000}`;
          break;
        }
        case 'greaterThanOrEqual': {
          where[id] = `duration >= ${Number(value[0]) * 1000}`;
          break;
        }
        case 'lessThan': {
          where[id] = `duration < ${Number(value[0]) * 1000}`;
          break;
        }
        case 'lessThanOrEqual': {
          where[id] = `duration <= ${Number(value[0]) * 1000}`;
          break;
        }
        case 'between': {
          if (value.length >= 2) {
            where[id] = `duration BETWEEN ${Number(value[0]) * 1000} AND ${Number(value[1]) * 1000}`;
          }
          break;
        }
        case 'is': {
          where[id] = `duration = ${Number(value[0]) * 1000}`;
          break;
        }
        case 'isNot': {
          where[id] = `duration != ${Number(value[0]) * 1000}`;
          break;
        }
        case 'isNull': {
          where[id] = `duration IS NULL`;
          break;
        }
        case 'isNotNull': {
          where[id] = `duration IS NOT NULL`;
          break;
        }
      }
      return;
    }

    if (
      name.startsWith('properties.') ||
      name.startsWith('profile.properties.')
    ) {
      const propertyKey = getSelectPropertyKey(name);
      const isWildcard = propertyKey.includes('%');
      const whereFrom = getSelectPropertyKey(name);

      switch (operator) {
        case 'is': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> ${value
              .map((val) => `x = ${escape(String(val).trim())}`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            if (value.length === 1) {
              where[id] = `${whereFrom} = ${escape(String(value[0]).trim())}`;
            } else {
              where[id] = `${whereFrom} IN (${value
                .map((val) => escape(String(val).trim()))
                .join(', ')})`;
            }
          }
          break;
        }
        case 'isNot': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> ${value
              .map((val) => `x != ${escape(String(val).trim())}`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            if (value.length === 1) {
              where[id] = `${whereFrom} != ${escape(String(value[0]).trim())}`;
            } else {
              where[id] = `${whereFrom} NOT IN (${value
                .map((val) => escape(String(val).trim()))
                .join(', ')})`;
            }
          }
          break;
        }
        case 'contains': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> ${value
              .map((val) => `x LIKE ${escape(`%${String(val).trim()}%`)}`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            where[id] = `(${value
              .map(
                (val) =>
                  `${whereFrom} LIKE ${escape(`%${String(val).trim()}%`)}`,
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'doesNotContain': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> ${value
              .map((val) => `x NOT LIKE ${escape(`%${String(val).trim()}%`)}`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            where[id] = `(${value
              .map(
                (val) =>
                  `${whereFrom} NOT LIKE ${escape(`%${String(val).trim()}%`)}`,
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'startsWith': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> ${value
              .map((val) => `x LIKE ${escape(`${String(val).trim()}%`)}`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            where[id] = `(${value
              .map(
                (val) =>
                  `${whereFrom} LIKE ${escape(`${String(val).trim()}%`)}`,
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'endsWith': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> ${value
              .map((val) => `x LIKE ${escape(`%${String(val).trim()}`)}`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            where[id] = `(${value
              .map(
                (val) =>
                  `${whereFrom} LIKE ${escape(`%${String(val).trim()}`)}`,
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'regex': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> ${value
              .map((val) => `match(x, ${escape(String(val).trim())})`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            where[id] = `(${value
              .map(
                (val) => `match(${whereFrom}, ${escape(String(val).trim())})`,
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'isNull': {
          if (isWildcard) {
            where[id] = `arrayExists(x -> x = '' OR x IS NULL, ${whereFrom})`;
          } else {
            where[id] = `(${whereFrom} = '' OR ${whereFrom} IS NULL)`;
          }
          break;
        }
        case 'isNotNull': {
          if (isWildcard) {
            where[id] =
              `arrayExists(x -> x != '' AND x IS NOT NULL, ${whereFrom})`;
          } else {
            where[id] = `(${whereFrom} != '' AND ${whereFrom} IS NOT NULL)`;
          }
          break;
        }
      }
    } else {
      switch (operator) {
        case 'is': {
          if (value.length === 1) {
            where[id] = `${name} = ${escape(String(value[0]).trim())}`;
          } else {
            where[id] = `${name} IN (${value
              .map((val) => escape(String(val).trim()))
              .join(', ')})`;
          }
          break;
        }
        case 'isNull': {
          where[id] = `(${name} = '' OR ${name} IS NULL)`;
          break;
        }
        case 'isNotNull': {
          where[id] = `(${name} != '' AND ${name} IS NOT NULL)`;
          break;
        }
        case 'isNot': {
          if (value.length === 1) {
            where[id] = `${name} != ${escape(String(value[0]).trim())}`;
          } else {
            where[id] = `${name} NOT IN (${value
              .map((val) => escape(String(val).trim()))
              .join(', ')})`;
          }
          break;
        }
        case 'contains': {
          where[id] = `(${value
            .map((val) => `${name} LIKE ${escape(`%${String(val).trim()}%`)}`)
            .join(' OR ')})`;
          break;
        }
        case 'doesNotContain': {
          where[id] = `(${value
            .map(
              (val) => `${name} NOT LIKE ${escape(`%${String(val).trim()}%`)}`,
            )
            .join(' OR ')})`;
          break;
        }
        case 'startsWith': {
          where[id] = `(${value
            .map((val) => `${name} LIKE ${escape(`${String(val).trim()}%`)}`)
            .join(' OR ')})`;
          break;
        }
        case 'endsWith': {
          where[id] = `(${value
            .map((val) => `${name} LIKE ${escape(`%${String(val).trim()}`)}`)
            .join(' OR ')})`;
          break;
        }
        case 'regex': {
          where[id] = `(${value
            .map(
              (val) =>
                `match(${name}, ${escape(stripLeadingAndTrailingSlashes(String(val)).trim())})`,
            )
            .join(' OR ')})`;
          break;
        }
        case 'greaterThan': {
          // For other numeric fields (not duration)
          const fieldName = getSelectPropertyKey(name);
          where[id] = `toFloat64OrNull(${fieldName}) > ${Number(value[0])}`;
          break;
        }
        case 'greaterThanOrEqual': {
          const fieldName = getSelectPropertyKey(name);
          where[id] = `toFloat64OrNull(${fieldName}) >= ${Number(value[0])}`;
          break;
        }
        case 'lessThan': {
          const fieldName = getSelectPropertyKey(name);
          where[id] = `toFloat64OrNull(${fieldName}) < ${Number(value[0])}`;
          break;
        }
        case 'lessThanOrEqual': {
          const fieldName = getSelectPropertyKey(name);
          where[id] = `toFloat64OrNull(${fieldName}) <= ${Number(value[0])}`;
          break;
        }
        case 'between': {
          if (value.length >= 2) {
            const fieldName = getSelectPropertyKey(name);
            where[id] = `toFloat64OrNull(${fieldName}) BETWEEN ${Number(value[0])} AND ${Number(value[1])}`;
          }
          break;
        }
      }
    }
  });

  return where;
}

export function getFirstSeenSql({
  event,
  breakdowns,
  interval,
  startDate,
  endDate,
  projectId,
  limit,
  timezone,
}: IGetChartDataInput & { timezone: string }) {
  // Build the first seen query using a subquery approach
  const eventFilters = getEventFiltersWhereClause(event.filters);
  const eventFilterClauses = Object.values(eventFilters).map(clause => `AND ${clause}`).join(' ');
  
  const breakdownSelects = breakdowns.length > 0 
    ? breakdowns.map((breakdown) => `${getSelectPropertyKey(breakdown.name)} as ${breakdown.name}`).join(', ') + ','
    : '';
  
  const breakdownGroupBy = breakdowns.length > 0 
    ? ', ' + breakdowns.map(b => b.name).join(', ')
    : '';

  // First, find the first occurrence of each profile/event combination
  const firstSeenSubquery = `
    SELECT 
      profile_id,
      ${event.name === '*' ? '' : `name,`}
      ${breakdownSelects}
      min(created_at) as first_seen_date
    FROM ${TABLE_NAMES.events}
    WHERE project_id = ${escape(projectId)}
      AND profile_id != ''
      ${event.name !== '*' ? `AND name = ${escape(event.name)}` : ''}
      ${eventFilterClauses}
    GROUP BY profile_id${event.name === '*' ? '' : ', name'}${breakdownGroupBy}
  `;

  // Then aggregate by time intervals
  let dateSelect: string;
  let dateFill: string;

  switch (interval) {
    case 'minute': {
      dateSelect = 'toStartOfMinute(first_seen_date) as date';
      dateFill = `date ASC WITH FILL FROM toStartOfMinute(toDateTime('${startDate}')) TO toStartOfMinute(toDateTime('${endDate}')) STEP toIntervalMinute(1)`;
      break;
    }
    case 'hour': {
      dateSelect = 'toStartOfHour(first_seen_date) as date';
      dateFill = `date ASC WITH FILL FROM toStartOfHour(toDateTime('${startDate}')) TO toStartOfHour(toDateTime('${endDate}')) STEP toIntervalHour(1)`;
      break;
    }
    case 'day': {
      dateSelect = 'toStartOfDay(first_seen_date) as date';
      dateFill = `date ASC WITH FILL FROM toStartOfDay(toDateTime('${startDate}')) TO toStartOfDay(toDateTime('${endDate}')) STEP toIntervalDay(1)`;
      break;
    }
    case 'week': {
      dateSelect = `toStartOfWeek(first_seen_date, 1, '${timezone}') as date`;
      dateFill = `date ASC WITH FILL FROM toStartOfWeek(toDateTime('${startDate}'), 1, '${timezone}') TO toStartOfWeek(toDateTime('${endDate}'), 1, '${timezone}') STEP toIntervalWeek(1)`;
      break;
    }
    case 'month': {
      dateSelect = `toStartOfMonth(first_seen_date, '${timezone}') as date`;
      dateFill = `date ASC WITH FILL FROM toStartOfMonth(toDateTime('${startDate}'), '${timezone}') TO toStartOfMonth(toDateTime('${endDate}'), '${timezone}') STEP toIntervalMonth(1)`;
      break;
    }
    default: {
      dateSelect = 'toStartOfDay(first_seen_date) as date';
      dateFill = `date ASC WITH FILL FROM toStartOfDay(toDateTime('${startDate}')) TO toStartOfDay(toDateTime('${endDate}')) STEP toIntervalDay(1)`;
      break;
    }
  }

  const breakdownSelectsForMain = breakdowns.length > 0 
    ? breakdowns.map(b => b.name).join(', ') + ','
    : '';

  const breakdownGroupByForMain = breakdowns.length > 0 
    ? ', ' + breakdowns.map(b => b.name).join(', ')
    : '';

  // Add event name as label for consistency with other chart types
  const labelSelect = event.name === '*' ? "'*' as label_0" : `${escape(event.name)} as label_0`;

  let sql = `
    SELECT 
      ${dateSelect},
      ${labelSelect},
      ${breakdownSelectsForMain}
      count(*) as count
    FROM (${firstSeenSubquery}) first_seen_data
    WHERE first_seen_date >= toDateTime('${formatClickhouseDate(startDate)}')
      AND first_seen_date <= toDateTime('${formatClickhouseDate(endDate)}')
    GROUP BY date${breakdownGroupByForMain}
    ORDER BY ${dateFill}
  `;

  // Handle breakdown limits
  if (breakdowns.length > 0 && limit) {
    const topBreakdownsSql = `
      SELECT ${breakdowns.map(b => b.name).join(', ')}, sum(count) as total_count
      FROM (${sql})
      GROUP BY ${breakdowns.map(b => b.name).join(', ')}
      ORDER BY total_count DESC
      LIMIT ${limit}
    `;

    sql = `
      SELECT *
      FROM (${sql}) main_query
      WHERE (${breakdowns.map(b => b.name).join(', ')}) IN (
        SELECT ${breakdowns.map(b => b.name).join(', ')}
        FROM (${topBreakdownsSql})
      )
      ORDER BY ${dateFill}
    `;
  }

  console.log('First Seen SQL:');
  console.log(sql);
  console.log('-- End --');
  return sql;
}
