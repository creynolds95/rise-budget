import { describe, expect, it } from 'vitest';
import { fetchSp500, parseStooq, parseYahoo } from '../src/lib/sp500';

const yahoo = {
  chart: {
    result: [
      {
        timestamp: [1_759_000_000, 1_759_086_400],
        indicators: { quote: [{ close: [5700.5, null] }] },
      },
    ],
  },
};

describe('sp500 parsing', () => {
  it('reads Yahoo closes as integer levels, skipping null days', () => {
    expect(parseYahoo(yahoo)).toEqual([{ date: '2025-09-27', level: 570_050 }]);
    expect(parseYahoo({})).toEqual([]);
  });
  it('reads Stooq CSV, skipping junk rows', () => {
    expect(
      parseStooq('Date,Open,High,Low,Close,Volume\n2026-09-01,1,2,3,5000.25,0\nbad,1\n'),
    ).toEqual([{ date: '2026-09-01', level: 500_025 }]);
  });
  it('falls back to Stooq, then to null', async () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n2026-09-01,1,2,3,10,0\n';
    const stooqOnly = (async (u: string) =>
      u.includes('yahoo')
        ? new Response('no', { status: 500 })
        : new Response(csv)) as unknown as typeof fetch;
    expect(await fetchSp500('2026-09-01', '2026-09-02', stooqOnly)).toEqual([
      { date: '2026-09-01', level: 1000 },
    ]);
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchSp500('2026-09-01', '2026-09-02', down)).toBeNull();
  });
});
