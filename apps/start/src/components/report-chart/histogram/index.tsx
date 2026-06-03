import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AspectContainer } from '../aspect-container';
import { ReportChartEmpty } from '../common/empty';
import { ReportChartError } from '../common/error';
import { ReportChartLoading } from '../common/loading';
import {
  useChartInput,
  useReleaseReportQueryQueue,
  useReportChartContext,
  useReportQueryQueue,
} from '../context';
import { Chart } from './chart';
import { useTRPC } from '@/integrations/trpc/react';

export function ReportHistogramChart() {
  const { isLazyLoading, shareId } = useReportChartContext();
  const chartInput = useChartInput();
  const trpc = useTRPC();
  const reportQuery = useReportQueryQueue(!isLazyLoading, [
    'chart',
    chartInput,
    shareId,
  ]);

  const res = useQuery(
    trpc.chart.chart.queryOptions(
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
    return <Loading />;
  }

  if (res.isError) {
    return <Error />;
  }

  if (!res.data || res.data?.series.length === 0) {
    return <Empty />;
  }

  return (
    <AspectContainer>
      <Chart data={res.data} />
    </AspectContainer>
  );
}

function Loading() {
  return (
    <AspectContainer>
      <ReportChartLoading />
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
