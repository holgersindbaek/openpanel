import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useReportChartContext } from '../context';
import { cn } from '@/utils/cn';

export type ReportChartLoadingState = 'queued' | 'fetching';

function useElapsedSeconds(enabled: boolean) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const update = () => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    const intervalId = window.setInterval(update, 1000);
    update();

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled]);

  return elapsedSeconds;
}

export function ReportChartLoading({
  state = 'fetching',
}: {
  state?: ReportChartLoadingState;
}) {
  const { isEditMode } = useReportChartContext();
  const elapsedSeconds = useElapsedSeconds(state === 'fetching');
  const label =
    state === 'queued' ? 'Queued...' : `Fetching (${elapsedSeconds}s)`;

  return (
    <div className={cn('h-full w-full', isEditMode && 'card p-4')}>
      <div
        className={
          'center-center relative flex h-full w-full overflow-hidden rounded bg-def-100'
        }
      >
        <div
          className={cn(
            'row items-center gap-2 font-medium text-muted-foreground text-sm',
            state === 'fetching' && 'text-foreground'
          )}
        >
          <Loader2Icon
            className={cn('size-4', state === 'fetching' && 'animate-spin')}
          />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
