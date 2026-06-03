export interface ReportDebugContext {
  id: string;
  route: string;
  projectId: string;
  reportId?: string;
}

interface ReportDebugLogger {
  info: (payload: Record<string, unknown>, message: string) => void;
  error?: (payload: Record<string, unknown>, message: string) => void;
  warn?: (payload: Record<string, unknown>, message: string) => void;
}

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isReportDebugLoggingEnabled() {
  return ENABLED_VALUES.has(
    (process.env.REPORT_DEBUG_LOGS ?? '').toLowerCase()
  );
}

export function logReportDebug(
  logger: ReportDebugLogger,
  event: string,
  context: ReportDebugContext | undefined,
  payload: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info'
) {
  if (!(isReportDebugLoggingEnabled() && context)) {
    return;
  }

  const logPayload = {
    event: `report.${event}`,
    reportDebugId: context.id,
    reportRoute: context.route,
    projectId: context.projectId,
    reportId: context.reportId,
    ...payload,
  };

  if (level === 'error' && logger.error) {
    logger.error(logPayload, `report.${event}`);
    return;
  }

  if (level === 'warn' && logger.warn) {
    logger.warn(logPayload, `report.${event}`);
    return;
  }

  logger.info(logPayload, `report.${event}`);
}

export function createReportQueryId(
  context: ReportDebugContext | undefined,
  ...parts: Array<string | number | undefined>
) {
  if (!(isReportDebugLoggingEnabled() && context)) {
    return undefined;
  }

  return ['report', context.id, ...parts]
    .filter((part) => part !== undefined)
    .join('_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 180);
}
