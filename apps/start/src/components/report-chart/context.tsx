import type { IChartSerie, IReportInput } from '@openpanel/validation';
import isEqual from 'lodash.isequal';
import type { LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

export interface ReportChartContextType {
  options: Partial<{
    columns: React.ReactNode[];
    hideLegend: boolean;
    hideXAxis: boolean;
    hideYAxis: boolean;
    aspectRatio: number;
    maxHeight: number;
    minHeight: number;
    maxDomain: number;
    onClick: (serie: IChartSerie) => void;
    renderSerieName: (names: string[]) => React.ReactNode;
    renderSerieIcon: (serie: IChartSerie) => React.ReactNode;
    dropdownMenuContent: (serie: IChartSerie) => {
      icon: LucideIcon;
      title: string;
      onClick: () => void;
    }[];
  }>;
  report: IReportInput & { id?: string };
  isLazyLoading: boolean;
  isEditMode: boolean;
  shareId?: string;
  reportId?: string;
}

type ReportChartContextProviderProps = ReportChartContextType & {
  children: React.ReactNode;
};

export type ReportChartProps = Partial<ReportChartContextType> & {
  report: IReportInput & { id?: string };
  lazy?: boolean;
};

const context = createContext<ReportChartContextType | null>(null);

interface ReportQuerySlot {
  enabled: boolean;
  isQueued: boolean;
  release: () => void;
}

interface ReportQueueEntry {
  id: string;
  priority: number;
  sequence: number;
}

const reportQueryQueue = (() => {
  let activeId: string | null = null;
  let sequence = 0;
  let promoteTimer: ReturnType<typeof setTimeout> | null = null;
  const queuedEntries: ReportQueueEntry[] = [];
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const sortQueuedEntries = () => {
    queuedEntries.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.sequence - b.sequence;
    });
  };

  const promote = () => {
    if (!activeId && queuedEntries.length > 0) {
      sortQueuedEntries();
      activeId = queuedEntries.shift()?.id ?? null;
    }
  };

  const schedulePromote = () => {
    if (promoteTimer) {
      return;
    }

    promoteTimer = setTimeout(() => {
      promoteTimer = null;
      const previousActiveId = activeId;
      promote();

      if (activeId !== previousActiveId) {
        emit();
      }
    }, 0);
  };

  const removeQueuedEntry = (id: string) => {
    const queueIndex = queuedEntries.findIndex((item) => item.id === id);
    if (queueIndex === -1) {
      return false;
    }

    queuedEntries.splice(queueIndex, 1);
    return true;
  };

  return {
    getSnapshot: () => activeId,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (id: string, priority: number) => {
      if (activeId === id) {
        return;
      }

      const existingEntry = queuedEntries.find((item) => item.id === id);
      if (existingEntry) {
        existingEntry.priority = priority;
      } else {
        queuedEntries.push({
          id,
          priority,
          sequence: sequence++,
        });
      }

      schedulePromote();
    },
    release: (id: string) => {
      const previousActiveId = activeId;
      let changed = false;

      if (activeId === id) {
        activeId = null;
        changed = true;
      }

      if (removeQueuedEntry(id)) {
        changed = true;
      }

      promote();

      if (changed || activeId !== previousActiveId) {
        emit();
      }
    },
  };
})();

function getReportQueuePriority(report: IReportInput & { id?: string }) {
  const layout = (
    report as IReportInput & {
      layout?: { x?: number | null; y?: number | null };
    }
  ).layout;
  const y = typeof layout?.y === 'number' ? layout.y : Number.MAX_SAFE_INTEGER;
  const x = typeof layout?.x === 'number' ? layout.x : Number.MAX_SAFE_INTEGER;

  return y * 1000 + x;
}

function stringifyReportQueryKey(key: unknown) {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

export const useReportChartContext = () => {
  const ctx = useContext(context);
  if (!ctx) {
    throw new Error(
      'useReportChartContext must be used within a ReportChartProvider'
    );
  }
  return ctx;
};

export const useReportQueryQueue = (
  enabled: boolean,
  queryKey: unknown
): ReportQuerySlot => {
  const { report } = useReportChartContext();
  const id = useId();
  const priority = getReportQueuePriority(report);
  const stableQueryKey = useMemo(
    () => stringifyReportQueryKey(queryKey),
    [queryKey]
  );
  const [releasedQueryKey, setReleasedQueryKey] = useState<string | null>(null);
  const activeId = useSyncExternalStore(
    reportQueryQueue.subscribe,
    reportQueryQueue.getSnapshot,
    reportQueryQueue.getSnapshot
  );
  const hasSlot = activeId === id;

  useEffect(() => {
    if (!enabled) {
      reportQueryQueue.release(id);
      return;
    }

    reportQueryQueue.request(id, priority);

    return () => {
      reportQueryQueue.release(id);
    };
  }, [enabled, id, priority, stableQueryKey]);

  const release = useCallback(() => {
    setReleasedQueryKey(stableQueryKey);
    reportQueryQueue.release(id);
  }, [id, stableQueryKey]);

  return {
    enabled: enabled && hasSlot,
    isQueued: enabled && releasedQueryKey !== stableQueryKey && !hasSlot,
    release,
  };
};

export const useReleaseReportQueryQueue = (
  slot: ReportQuerySlot,
  fetchStatus: 'fetching' | 'paused' | 'idle',
  status: 'pending' | 'error' | 'success'
) => {
  useEffect(() => {
    if (!slot.enabled || fetchStatus !== 'idle' || status === 'pending') {
      return;
    }

    const timeoutId = window.setTimeout(slot.release, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [slot.enabled, slot.release, fetchStatus, status]);
};

/**
 * Returns the report input suitable for chart queries — strips display-only
 * fields (like visibleSeries) that shouldn't affect the query cache key.
 */
export const useChartInput = () => {
  const { report, isEditMode } = useReportChartContext();
  return useMemo(() => {
    const { visibleSeries, ...input } = report;
    return {
      ...input,
      includeTotalCount: isEditMode || input.metric === 'count',
    };
  }, [report, isEditMode]);
};

export const ReportChartProvider = ({
  children,
  ...propsToContext
}: ReportChartContextProviderProps) => {
  const [ctx, setContext] = useState(propsToContext);

  useEffect(() => {
    if (!isEqual(ctx, propsToContext)) {
      setContext(propsToContext);
    }
  }, [propsToContext]);

  return <context.Provider value={ctx}>{children}</context.Provider>;
};

export default context;
