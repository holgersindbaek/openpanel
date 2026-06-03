import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AspectContainer } from '../aspect-container';
import { ReportChartEmpty } from '../common/empty';
import { ReportChartError } from '../common/error';
import {
  ReportChartLoading,
  type ReportChartLoadingState,
} from '../common/loading';
import {
  useChartInput,
  useReleaseReportQueryQueue,
  useReportChartContext,
  useReportQueryQueue,
} from '../context';
import { Chart } from './chart';
import { useTRPC } from '@/integrations/trpc/react';

export function ReportBarChart() {
  const { isLazyLoading, shareId } = useReportChartContext();
  const chartInput = useChartInput();
  const trpc = useTRPC();
  const reportQuery = useReportQueryQueue(!isLazyLoading, [
    'aggregate',
    chartInput,
    shareId,
  ]);

  const res = useQuery(
    trpc.chart.aggregate.queryOptions(
      {
        ...chartInput,
        shareId,
      },
      {
        placeholderData: keepPreviousData,
        enabled: reportQuery.enabled,
        trpc: { abortOnUnmount: true },
      }
    )
  );
  useReleaseReportQueryQueue(reportQuery, res.fetchStatus, res.status);

  if (
    isLazyLoading ||
    reportQuery.isQueued ||
    res.isLoading ||
    (res.isFetching && !res.data?.series.length)
  ) {
    return (
      <Loading
        state={isLazyLoading || reportQuery.isQueued ? 'queued' : 'fetching'}
      />
    );
  }
  if (res.isError) {
    return <Error />;
  }

  if (!res.data || res.data?.series.length === 0) {
    return <Empty />;
  }

  return <Chart data={res.data} />;
}

function Loading({ state }: { state: ReportChartLoadingState }) {
  return (
    <AspectContainer>
      <ReportChartLoading state={state} />
    </AspectContainer>
  );
}

function Error() {
  return (
    <AspectContainer>
      <ReportChartError />
    </AspectContainer>
  );
}

function Empty() {
  return (
    <AspectContainer>
      <ReportChartEmpty />
    </AspectContainer>
  );
}
