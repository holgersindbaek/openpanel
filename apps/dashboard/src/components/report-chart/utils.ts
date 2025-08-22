import type { IChartProps } from '@openpanel/validation';

/**
 * Clean up undefined dates in report object for API calls
 * This prevents undefined values from being serialized as "undefined" strings
 */
export function cleanReportForApi(report: IChartProps): IChartProps {
  const cleanedReport = { ...report };

  // Remove undefined dates
  if (cleanedReport.startDate === undefined) {
    delete cleanedReport.startDate;
  }
  if (cleanedReport.endDate === undefined) {
    delete cleanedReport.endDate;
  }

  return cleanedReport;
}
