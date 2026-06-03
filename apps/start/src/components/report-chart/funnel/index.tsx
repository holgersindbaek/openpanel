import { useQuery } from '@tanstack/react-query';
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
import { BreakdownList } from './breakdown-list';
import { Chart, Summary } from './chart';
import { changeVisibleSeries } from '@/components/report/reportSlice';
import { useVisibleFunnelBreakdowns } from '@/hooks/use-visible-funnel-breakdowns';
import { useTRPC } from '@/integrations/trpc/react';
import { useDispatch } from '@/redux';

export function ReportFunnelChart() {
  const { isLazyLoading, report, shareId, isEditMode } =
    useReportChartContext();
  const chartInput = useChartInput();
  const dispatch = useDispatch();
  const trpc = useTRPC();
  const baseEnabled = !isLazyLoading && chartInput.series.length > 0;
  const reportQuery = useReportQueryQueue(baseEnabled, [
    'funnel',
    chartInput,
    shareId,
  ]);
  const res = useQuery(
    trpc.chart.funnel.queryOptions(
      {
        ...chartInput,
        shareId,
      },
      {
        enabled: reportQuery.enabled,
        trpc: { abortOnUnmount: true },
      }
    )
  );
  useReleaseReportQueryQueue(reportQuery, res.fetchStatus, res.status);

  // Hook for limiting which breakdowns are shown in the chart only
  const { breakdowns: visibleBreakdowns, setVisibleSeries } =
    useVisibleFunnelBreakdowns(res.data?.current ?? [], {
      limit: 10,
      savedVisibleSeries: report.visibleSeries,
      onVisibleSeriesChange: isEditMode
        ? (ids) => dispatch(changeVisibleSeries(ids))
        : undefined,
    });

  if (isLazyLoading || reportQuery.isQueued || res.isLoading) {
    return (
      <Loading
        state={isLazyLoading || reportQuery.isQueued ? 'queued' : 'fetching'}
      />
    );
  }

  if (res.isError) {
    return <Error />;
  }

  if (!res.data || res.data.current.length === 0) {
    return <Empty />;
  }

  const hasBreakdowns = res.data.current.length > 1;

  return (
    <div className="col gap-4">
      {hasBreakdowns && <Summary data={res.data} />}
      <Chart data={res.data} visibleBreakdowns={visibleBreakdowns} />
      <BreakdownList
        data={res.data}
        setVisibleSeries={setVisibleSeries}
        visibleSeriesIds={visibleBreakdowns.map((b) => b.id)}
      />
    </div>
  );
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
