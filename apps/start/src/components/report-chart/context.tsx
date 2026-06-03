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

const reportQueryQueue = (() => {
  let activeId: string | null = null;
  const queuedIds: string[] = [];
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const promote = () => {
    if (!activeId) {
      activeId = queuedIds.shift() ?? null;
    }
  };

  return {
    getSnapshot: () => activeId,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (id: string) => {
      if (activeId === id || queuedIds.includes(id)) {
        return;
      }

      queuedIds.push(id);
      const previousActiveId = activeId;
      promote();

      if (activeId !== previousActiveId || activeId === id) {
        emit();
      }
    },
    release: (id: string) => {
      const previousActiveId = activeId;
      let changed = false;

      if (activeId === id) {
        activeId = null;
        changed = true;
      }

      const queueIndex = queuedIds.indexOf(id);
      if (queueIndex !== -1) {
        queuedIds.splice(queueIndex, 1);
        changed = true;
      }

      promote();

      if (changed || activeId !== previousActiveId) {
        emit();
      }
    },
  };
})();

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
  const id = useId();
  const stableQueryKey = useMemo(
    () => stringifyReportQueryKey(queryKey),
    [queryKey]
  );
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

    reportQueryQueue.request(id);

    return () => {
      reportQueryQueue.release(id);
    };
  }, [enabled, id, stableQueryKey]);

  const release = useCallback(() => {
    reportQueryQueue.release(id);
  }, [id]);

  return {
    enabled: enabled && hasSlot,
    isQueued: enabled && !hasSlot,
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
