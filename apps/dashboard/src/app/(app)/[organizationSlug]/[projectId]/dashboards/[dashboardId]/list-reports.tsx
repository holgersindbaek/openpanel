'use client';

import { FullPageEmptyState } from '@/components/full-page-empty-state';
import { useOverviewOptions } from '@/components/overview/useOverviewOptions';
import { ReportChart } from '@/components/report-chart';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppParams } from '@/hooks/useAppParams';
import { api, handleError } from '@/trpc/client';
import { cn } from '@/utils/cn';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  GripVertical,
  LayoutPanelTopIcon,
  MoreHorizontal,
  PlusIcon,
  Trash,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  getDefaultIntervalByDates,
  getDefaultIntervalByRange,
  timeWindows,
} from '@openpanel/constants';
import type { IServiceDashboard, getReportsByDashboardId } from '@openpanel/db';
import type { IChartRange, IInterval } from '@openpanel/validation';

import { OverviewInterval } from '@/components/overview/overview-interval';
import { OverviewRange } from '@/components/overview/overview-range';

interface ListReportsProps {
  reports: Awaited<ReturnType<typeof getReportsByDashboardId>>;
  dashboard: IServiceDashboard;
}

interface SortableReportCardProps {
  report: Awaited<ReturnType<typeof getReportsByDashboardId>>[0];
  params: any;
  range: string | null;
  startDate: string | null;
  endDate: string | null;
  interval: string;
  onDelete: (reportId: string) => void;
}

function SortableReportCard({
  report,
  params,
  range,
  startDate,
  endDate,
  interval,
  onDelete,
}: SortableReportCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: report.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const chartRange = report.range;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('card h-fit relative', isDragging && 'z-50')}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-2 top-6 z-10 cursor-grab touch-none p-1 hover:bg-muted rounded"
      >
        <GripVertical size={16} className="text-muted-foreground" />
      </div>
      <Link
        href={`/${params.organizationId}/${params.projectId}/reports/${report.id}`}
        className="flex items-center justify-between border-b border-border p-4 pl-10 leading-none [&_svg]:hover:opacity-100"
        shallow
      >
        <div>
          <div className="font-medium">{report.name}</div>
          {chartRange !== null && (
            <div className="mt-2 flex gap-2 ">
              <span
                className={
                  (chartRange !== range && range !== null) ||
                  (startDate && endDate)
                    ? 'line-through'
                    : ''
                }
              >
                {timeWindows[chartRange].label}
              </span>
              {startDate && endDate ? (
                <span>Custom dates</span>
              ) : (
                range !== null &&
                chartRange !== range && <span>{timeWindows[range as keyof typeof timeWindows].label}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded hover:border">
              <MoreHorizontal size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onDelete(report.id);
                  }}
                >
                  <Trash size={16} className="mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ChevronRight className="opacity-10 transition-opacity" size={16} />
        </div>
      </Link>
      <div className={cn('p-4', report.chartType === 'metric' && 'p-0')}>
        <ReportChart
          {...report}
          report={{
            ...report,
            range: (range ?? report.range) as IChartRange,
            startDate: startDate ?? report.startDate,
            endDate: endDate ?? report.endDate,
            interval: (interval ?? report.interval) as IInterval,
          }}
        />
      </div>
    </div>
  );
}

export function ListReports({
  reports: initialReports,
  dashboard,
}: ListReportsProps) {
  const router = useRouter();
  const params = useAppParams<{ dashboardId: string }>();
  const { range, startDate, endDate, interval } = useOverviewOptions();
  const [reports, setReports] = useState(initialReports);

  const deletion = api.report.delete.useMutation({
    onError: handleError,
    onSuccess() {
      router.refresh();
      toast('Report deleted');
    },
  });

  const updateReportOrder = api.report.updateOrder.useMutation({
    onError: handleError,
    onSuccess() {
      toast('Report order updated');
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setReports((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);

        // Update order on backend
        updateReportOrder.mutate({
          dashboardId: dashboard.id,
          reportIds: newOrder.map((r) => r.id),
        });

        return newOrder;
      });
    }
  };

  const handleDelete = (reportId: string) => {
    deletion.mutate({ reportId });
  };

  return (
    <>
      <div className="row mb-4 items-center justify-between">
        <h1 className="text-3xl font-semibold">{dashboard.name}</h1>
        <div className="flex items-center justify-end gap-2">
          <OverviewRange />
          <OverviewInterval />
          <Button
            icon={PlusIcon}
            onClick={() => {
              router.push(
                `/${params.organizationId}/${
                  params.projectId
                }/reports?${new URLSearchParams({
                  dashboardId: params.dashboardId,
                }).toString()}`,
              );
            }}
          >
            <span className="max-sm:hidden">Create report</span>
            <span className="sm:hidden">Report</span>
          </Button>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={reports.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid gap-8 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
            {reports.map((report) => (
              <SortableReportCard
                key={report.id}
                report={report}
                params={params}
                range={range}
                startDate={startDate}
                endDate={endDate}
                interval={interval}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {reports.length === 0 && (
        <FullPageEmptyState title="No reports" icon={LayoutPanelTopIcon}>
          <p>You can visualize your data with a report</p>
          <Button
            onClick={() =>
              router.push(
                `/${params.organizationId}/${
                  params.projectId
                }/reports?${new URLSearchParams({
                  dashboardId: params.dashboardId,
                }).toString()}`,
              )
            }
            className="mt-14"
            icon={PlusIcon}
          >
            Create report
          </Button>
        </FullPageEmptyState>
      )}
    </>
  );
}
