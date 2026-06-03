import { describe, expect, it } from 'vitest';
import { compute } from './compute';
import type { ConcreteSeries, SeriesDefinition } from './types';

const eventDefinition = (id: string, name: string): SeriesDefinition => ({
  type: 'event',
  id,
  name,
  segment: 'event',
  filters: [],
});

const formulaDefinition = (
  id: string,
  formula: string,
  displayName = formula
): SeriesDefinition => ({
  type: 'formula',
  id,
  formula,
  displayName,
});

const series = (
  definition: SeriesDefinition,
  definitionIndex: number,
  name: string[],
  data: ConcreteSeries['data']
): ConcreteSeries => ({
  id: definition.id ?? String(definitionIndex),
  definitionId: definition.id ?? String(definitionIndex),
  definitionIndex,
  name,
  context: {
    filters: [],
  },
  data,
  definition,
});

describe('compute', () => {
  it('computes formulas across breakdown series without changing totals', () => {
    const definitions = [
      eventDefinition('event-a', 'A'),
      eventDefinition('event-b', 'B'),
      formulaDefinition('formula-c', 'A + B', 'Combined'),
    ];
    const result = compute(
      [
        series(
          definitions[0]!,
          0,
          ['A', 'US'],
          [
            { date: '2026-05-01', count: 10, total_count: 20 },
            { date: '2026-05-02', count: 7, total_count: 20 },
          ]
        ),
        series(
          definitions[1]!,
          1,
          ['B', 'US'],
          [{ date: '2026-05-01', count: 5, total_count: 10 }]
        ),
      ],
      definitions
    );

    const formula = result.find((item) => item.definitionIndex === 2);

    expect(formula?.name).toEqual(['Combined', 'US']);
    expect(formula?.data).toEqual([
      { date: '2026-05-01', count: 15, total_count: 30 },
      { date: '2026-05-02', count: 7, total_count: 30 },
    ]);
  });

  it('allows formulas to reference previous formulas', () => {
    const definitions = [
      eventDefinition('event-a', 'A'),
      eventDefinition('event-b', 'B'),
      formulaDefinition('formula-c', 'A + B', 'Combined'),
      formulaDefinition('formula-d', 'C / A', 'Rate'),
    ];
    const result = compute(
      [
        series(
          definitions[0]!,
          0,
          ['A'],
          [{ date: '2026-05-01', count: 10, total_count: 20 }]
        ),
        series(
          definitions[1]!,
          1,
          ['B'],
          [{ date: '2026-05-01', count: 5, total_count: 10 }]
        ),
      ],
      definitions
    );

    const formula = result.find((item) => item.definitionIndex === 3);

    expect(formula?.name).toEqual(['Rate']);
    expect(formula?.data).toEqual([
      { date: '2026-05-01', count: 1.5, total_count: 1.5 },
    ]);
  });

  it('keeps invalid formulas contained to zero-valued output', () => {
    const definitions = [
      eventDefinition('event-a', 'A'),
      formulaDefinition('formula-b', 'A +', 'Invalid'),
    ];

    const result = compute(
      [
        series(
          definitions[0]!,
          0,
          ['A'],
          [{ date: '2026-05-01', count: 10, total_count: 20 }]
        ),
      ],
      definitions
    );

    const formula = result.find((item) => item.definitionIndex === 1);

    expect(formula?.data).toEqual([
      { date: '2026-05-01', count: 0, total_count: undefined },
    ]);
  });
});
