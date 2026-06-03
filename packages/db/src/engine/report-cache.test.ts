import { describe, expect, it } from 'vitest';
import { mergeConcreteSeriesChunks } from './report-cache';
import type { ConcreteSeries, SeriesDefinition } from './types';

const definition: SeriesDefinition = {
  type: 'event',
  id: 'A',
  name: 'screen_view',
  segment: 'event',
  filters: [],
};

function series(id: string, data: ConcreteSeries['data']): ConcreteSeries {
  return {
    id,
    definitionId: 'A',
    definitionIndex: 0,
    name: ['screen_view'],
    context: {
      event: 'screen_view',
      filters: [],
    },
    data,
    definition,
  };
}

describe('report-cache engine helpers', () => {
  it('merges cached and raw chunks by series identity and date', () => {
    const result = mergeConcreteSeriesChunks([
      [
        series('screen-view-a', [
          { date: '2026-05-02 00:00:00', count: 2 },
          { date: '2026-05-01 00:00:00', count: 1 },
        ]),
      ],
      [series('screen-view-a', [{ date: '2026-05-03 00:00:00', count: 3 }])],
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.data).toEqual([
      { date: '2026-05-01 00:00:00', count: 1 },
      { date: '2026-05-02 00:00:00', count: 2 },
      { date: '2026-05-03 00:00:00', count: 3 },
    ]);
  });

  it('keeps different expanded series separate', () => {
    const result = mergeConcreteSeriesChunks([
      [
        series('screen-view-a', [{ date: '2026-05-01 00:00:00', count: 1 }]),
        {
          ...series('signup-a', [{ date: '2026-05-01 00:00:00', count: 2 }]),
          definitionId: 'B',
          definitionIndex: 1,
          name: ['signup'],
        },
      ],
    ]);

    expect(result.map((item) => item.name)).toEqual([
      ['screen_view'],
      ['signup'],
    ]);
  });
});
