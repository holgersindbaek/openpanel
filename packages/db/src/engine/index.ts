import type { ISerieDataItem } from '@openpanel/common';
import { groupByLabels } from '@openpanel/common';
import { alphabetIds } from '@openpanel/constants';
import type {
  FinalChart,
  IChartEventItem,
  IReportInput,
} from '@openpanel/validation';
import { chQuery } from '../clickhouse/client';
import { getAggregateChartSql } from '../services/chart.service';
import { getChartPrevStartEndDate } from '../services/date.service';
import {
  getOrganizationSubscriptionChartEndDate,
  getSettingsForProject,
} from '../services/organization.service';
import { compute } from './compute';
import { fetch } from './fetch';
import { format } from './format';
import { normalize } from './normalize';
import { plan } from './plan';
import type { ConcreteSeries } from './types';

/**
 * Chart Engine - Main entry point
 * Executes the pipeline: normalize -> plan -> fetch -> compute -> format
 */
export async function executeChart(input: IReportInput): Promise<FinalChart> {
  // Stage 1: Normalize input
  const normalized = await normalize(input);

  // Handle subscription end date limit
  const endDate = await getOrganizationSubscriptionChartEndDate(
    input.projectId,
    normalized.endDate
  );
  if (endDate) {
    normalized.endDate = endDate;
  }

  // Stage 2: Create execution plan
  const executionPlan = await plan(normalized);

  // Stage 3: Fetch data for event series (current period)
  const fetchedSeries = await fetch(executionPlan);

  // Stage 4: Compute formula series
  const computedSeries = compute(fetchedSeries, executionPlan.definitions);

  // Stage 5: Fetch previous period if requested
  let previousSeries: ConcreteSeries[] | null = null;
  if (input.previous) {
    const currentPeriod = {
      startDate: normalized.startDate,
      endDate: normalized.endDate,
    };
    const previousPeriod = getChartPrevStartEndDate(currentPeriod);

    const previousPlan = await plan({
      ...normalized,
      ...previousPeriod,
    });

    const previousFetched = await fetch(previousPlan);
    previousSeries = compute(previousFetched, previousPlan.definitions);
  }

  // Stage 6: Format final output with previous period data
  const includeAlphaIds = executionPlan.definitions.length > 1;
  const response = format(
    computedSeries,
    executionPlan.definitions,
    includeAlphaIds,
    previousSeries,
    normalized.limit
  );

  return response;
}

/**
 * Aggregate Chart Engine - Optimized for bar/pie charts without time series
 * Executes a simplified pipeline: normalize -> fetch aggregate -> format
 */
export async function executeAggregateChart(
  input: IReportInput
): Promise<FinalChart> {
  // Stage 1: Normalize input
  const normalized = await normalize(input);

  // Handle subscription end date limit
  const endDate = await getOrganizationSubscriptionChartEndDate(
    input.projectId,
    normalized.endDate
  );
  if (endDate) {
    normalized.endDate = endDate;
  }

  const { timezone } = await getSettingsForProject(normalized.projectId);

  // Stage 2: Fetch aggregate data for current period (event series only)
  const fetchedSeries = await fetchAggregateSeries({
    input: normalized,
    timezone,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
  });

  // Stage 3: Compute formula series from fetched event series
  const computedSeries = compute(fetchedSeries, normalized.series);

  // Stage 4: Fetch previous period if requested
  let previousSeries: ConcreteSeries[] | null = null;
  if (input.previous) {
    const currentPeriod = {
      startDate: normalized.startDate,
      endDate: normalized.endDate,
    };
    const previousPeriod = getChartPrevStartEndDate(currentPeriod);

    const previousFetchedSeries = await fetchAggregateSeries({
      input: normalized,
      timezone,
      startDate: previousPeriod.startDate,
      endDate: previousPeriod.endDate,
    });

    // Compute formula series for previous period
    previousSeries = compute(previousFetchedSeries, normalized.series);
  }

  // Stage 5: Format final output with previous period data
  const includeAlphaIds = normalized.series.length > 1;
  const response = format(
    computedSeries,
    normalized.series,
    includeAlphaIds,
    previousSeries,
    normalized.limit
  );

  return response;
}

// Export as ChartEngine for backward compatibility
export const ChartEngine = {
  execute: executeChart,
};

// Export aggregate chart engine
export const AggregateChartEngine = {
  execute: executeAggregateChart,
};

async function fetchAggregateSeries({
  input,
  timezone,
  startDate,
  endDate,
}: {
  input: Awaited<ReturnType<typeof normalize>>;
  timezone: string;
  startDate: string;
  endDate: string;
}): Promise<ConcreteSeries[]> {
  const eventDefinitions = input.series
    .map((definition, definitionIndex) => ({ definition, definitionIndex }))
    .filter(
      (
        item
      ): item is typeof item & {
        definition: typeof item.definition & { type: 'event' };
      } => item.definition.type === 'event'
    );

  const results = await Promise.all(
    eventDefinitions.map(async ({ definition, definitionIndex }) => {
      const event = definition as IChartEventItem & { type: 'event' };
      const queryInput = {
        event: {
          id: event.id,
          name: event.name,
          segment: event.segment,
          filters: event.filters,
          displayName: event.displayName,
          property: event.property,
        },
        projectId: input.projectId,
        startDate,
        endDate,
        breakdowns: input.breakdowns,
        limit: input.limit,
        metric: input.metric,
        previous: input.previous,
        timezone,
      };

      let queryResult = await chQuery<ISerieDataItem>(
        await getAggregateChartSql(queryInput),
        {
          session_timezone: timezone,
        }
      );

      if (queryResult.length === 0 && input.breakdowns.length > 0) {
        queryResult = await chQuery<ISerieDataItem>(
          await getAggregateChartSql({
            ...queryInput,
            breakdowns: [],
          }),
          {
            session_timezone: timezone,
          }
        );
      }

      return groupByLabels(queryResult).map((grouped) => {
        const breakdownValue =
          input.breakdowns.length > 0 && grouped.name.length > 1
            ? grouped.name.slice(1).join(' - ')
            : undefined;

        const breakdowns: Record<string, string> | undefined =
          input.breakdowns.length > 0 && grouped.name.length > 1
            ? {}
            : undefined;

        if (breakdowns) {
          input.breakdowns.forEach((breakdown, idx) => {
            const breakdownNamePart = grouped.name[idx + 1];
            if (breakdownNamePart) {
              breakdowns[breakdown.name] = breakdownNamePart;
            }
          });
        }

        const filters = [...event.filters];
        if (breakdownValue && input.breakdowns.length > 0) {
          input.breakdowns.forEach((breakdown, idx) => {
            const breakdownNamePart = grouped.name[idx + 1];
            if (breakdownNamePart) {
              filters.push({
                id: `breakdown-${idx}`,
                name: breakdown.name,
                operator: 'is',
                value: [breakdownNamePart],
              });
            }
          });
        }

        return {
          id: `${event.name}-${grouped.name.join('-')}-${definitionIndex}`,
          definitionId:
            definition.id ??
            alphabetIds[definitionIndex] ??
            `series-${definitionIndex}`,
          definitionIndex,
          name: grouped.name,
          context: {
            event: event.name,
            filters,
            breakdownValue,
            breakdowns,
          },
          data: grouped.data,
          definition,
        } satisfies ConcreteSeries;
      });
    })
  );

  return results.flat();
}
