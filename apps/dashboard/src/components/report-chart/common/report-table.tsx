import { Pagination, usePagination } from '@/components/pagination';
import { Stats, StatsCard } from '@/components/stats';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltiper } from '@/components/ui/tooltip';
import { useFormatDateInterval } from '@/hooks/useFormatDateInterval';
import { useNumber } from '@/hooks/useNumerFormatter';
import { useSelector } from '@/redux';
import { getPropertyLabel } from '@/translations/properties';
import type { IChartData } from '@/trpc/client';
import { getChartColor } from '@/utils/theme';
import { round } from '@openpanel/common';
import type * as React from 'react';

import { PreviousDiffIndicator } from './previous-diff-indicator';
import { SerieName } from './serie-name';

interface ReportTableProps {
  data: IChartData;
  visibleSeries: IChartData['series'];
  setVisibleSeries: React.Dispatch<React.SetStateAction<string[]>>;
}

const ROWS_LIMIT = 50;

export function ReportTable({
  data,
  visibleSeries,
  setVisibleSeries,
}: ReportTableProps) {
  const { setPage, paginate, page } = usePagination(ROWS_LIMIT);
  const number = useNumber();
  const interval = useSelector((state) => state.report.interval);
  const breakdowns = useSelector((state) => state.report.breakdowns);
  const events = useSelector((state) => state.report.events);
  const unit = useSelector((state) => state.report.unit);
  const formatDate = useFormatDateInterval(interval);

  // Check if all events are using the same property for aggregation
  const property =
    events.length > 0 && events.every((e) => e.property === events[0]?.property)
      ? events[0]?.property
      : undefined;

  function handleChange(name: string, checked: boolean) {
    setVisibleSeries((prev) => {
      if (checked) {
        return [...prev, name];
      }
      return prev.filter((item) => item !== name);
    });
  }

  return (
    <>
      <Stats className="my-4 grid grid-cols-1 @xl:grid-cols-3 @4xl:grid-cols-6">
        <StatsCard
          title="Total"
          value={number.formatWithUnit(data.metrics.sum, unit, property)}
        />
        <StatsCard
          title="Average"
          value={number.formatWithUnit(data.metrics.average, unit, property)}
        />
        <StatsCard
          title="Min"
          value={number.formatWithUnit(data.metrics.min, unit, property)}
        />
        <StatsCard
          title="Max"
          value={number.formatWithUnit(data.metrics.max, unit, property)}
        />
      </Stats>
      <div className="grid grid-cols-[max(300px,30vw)_1fr] overflow-hidden rounded-md border border-border">
        <Table className="rounded-none border-b-0 border-l-0 border-t-0">
          <TableHeader>
            <TableRow>
              {breakdowns.length === 0 && <TableHead>Name</TableHead>}
              {breakdowns.map((breakdown) => (
                <TableHead key={breakdown.name}>
                  {getPropertyLabel(breakdown.name)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="bg-def-100">
            {paginate(data.series).map((serie, index) => {
              const checked = !!visibleSeries.find(
                (item) => item.id === serie.id,
              );

              return (
                <TableRow key={`${serie.id}-1`}>
                  {serie.names.map((name, nameIndex) => {
                    return (
                      <TableCell className="h-10" key={name}>
                        <div className="flex items-center gap-2">
                          {nameIndex === 0 ? (
                            <>
                              <Checkbox
                                onCheckedChange={(checked) =>
                                  handleChange(serie.id, !!checked)
                                }
                                style={
                                  checked
                                    ? {
                                        background: getChartColor(index),
                                        borderColor: getChartColor(index),
                                      }
                                    : undefined
                                }
                                checked={checked}
                              />
                              <Tooltiper
                                side="left"
                                sideOffset={30}
                                content={<SerieName name={serie.names} />}
                              >
                                {name}
                              </Tooltiper>
                            </>
                          ) : (
                            <SerieName name={name} />
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="overflow-auto">
          <Table className="rounded-none border-none">
            <TableHeader>
              <TableRow>
                <TableHead>Total</TableHead>
                <TableHead>Average</TableHead>
                <TableHead>Percentage</TableHead>
                {data.series[0]?.data.map((serie) => (
                  <TableHead
                    key={serie.date.toString()}
                    className="whitespace-nowrap"
                  >
                    {formatDate(serie.date)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginate(data.series).map((serie) => {
                const percentage =
                  data.metrics.sum === 0
                    ? 0
                    : round((serie.metrics.sum / data.metrics.sum) * 100, 2);

                return (
                  <TableRow key={`${serie.id}-2`}>
                    <TableCell className="h-10">
                      <div className="flex items-center gap-2 font-medium">
                        {number.formatWithUnit(
                          serie.metrics.sum,
                          unit,
                          property,
                        )}
                        <PreviousDiffIndicator
                          {...serie.metrics.previous?.sum}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="h-10">
                      <div className="flex items-center gap-2 font-medium">
                        {number.formatWithUnit(
                          serie.metrics.average,
                          unit,
                          property,
                        )}
                        <PreviousDiffIndicator
                          {...serie.metrics.previous?.average}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="h-10">
                      <div className="flex items-center gap-2 font-medium text-muted-foreground">
                        {number.format(percentage)}%
                      </div>
                    </TableCell>

                    {serie.data.map((item) => {
                      return (
                        <TableCell className="h-10" key={item.date.toString()}>
                          <div className="flex items-center gap-2">
                            {number.format(item.count)}
                            <PreviousDiffIndicator {...item.previous} />
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="row mt-4 justify-end">
        <Pagination
          cursor={page}
          setCursor={setPage}
          take={ROWS_LIMIT}
          count={data.series.length}
        />
      </div>
    </>
  );
}
