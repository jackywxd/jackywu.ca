import { describe, expect, it } from 'vitest';
import { deriveStatus, groupByYear, latestRequestByDoc } from '../src/lib/tale-status';

describe('deriveStatus', () => {
  it.each([
    [{ live: false, latest: 'draft' as const }, 'draft'],
    [{ live: true, latest: 'published' as const }, 'live'],
    [{ live: true, latest: 'draft' as const }, 'live-edited'],
    [{ live: false, latest: 'draft' as const, request: { status: 'queued' as const, kind: 'publish' as const, createdAt: 1 } }, 'queued'],
    [{ live: true, latest: 'draft' as const, request: { status: 'dispatched' as const, kind: 'publish' as const, createdAt: 1 } }, 'building'],
    [{ live: false, latest: 'draft' as const, request: { status: 'failed' as const, kind: 'publish' as const, createdAt: 1 } }, 'failed'],
    [{ live: true, latest: 'published' as const, request: { status: 'deployed' as const, kind: 'publish' as const, createdAt: 1 } }, 'live'],
  ])('%j → %s', (args, key) => expect(deriveStatus(args).key).toBe(key));
  it('每個狀態都有文字標籤與符號（不只靠顏色）', () => {
    for (const k of ['draft', 'queued', 'building', 'failed', 'live', 'live-edited'] as const) {
      const s = deriveStatus(k === 'live' ? { live: true, latest: 'published' } : k === 'live-edited' ? { live: true, latest: 'draft' } : k === 'draft' ? { live: false, latest: 'draft' } : { live: false, latest: 'draft', request: { status: k === 'queued' ? 'queued' : k === 'building' ? 'dispatched' : 'failed', kind: 'publish', createdAt: 1 } });
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.mark.length).toBeGreaterThan(0);
    }
  });
});

describe('latestRequestByDoc', () => {
  it('每篇只留最新一筆', () => {
    const m = latestRequestByDoc([
      { docId: '1', status: 'failed', kind: 'publish', createdAt: 1 }, { docId: '1', status: 'queued', kind: 'publish', createdAt: 5 },
      { docId: '2', status: 'deployed', kind: 'publish', createdAt: 3 },
    ]);
    expect(m.get('1')?.status).toBe('queued');
    expect(m.get('2')?.status).toBe('deployed');
  });
  it('輸入順序不影響結果', () => {
    const a = { docId: '1', status: 'failed' as const, kind: 'publish' as const, createdAt: 9 };
    const b = { docId: '1', status: 'queued' as const, kind: 'publish' as const, createdAt: 2 };
    expect(latestRequestByDoc([a, b]).get('1')).toBe(a);
    expect(latestRequestByDoc([b, a]).get('1')).toBe(a);
  });
});

describe('groupByYear', () => {
  it('年份新的在前，同年依日期新的在前，沒有日期的歸「未定」放最前面', () => {
    const g = groupByYear([{ date: '2025-03-01' }, { date: '2026-01-05' }, { date: '2026-08-01' }, { date: null }, {}]);
    expect(g.map((x) => x.year)).toEqual(['未定', '2026', '2025']);
    expect(g[1]!.items.map((i) => i.date)).toEqual(['2026-08-01', '2026-01-05']);
    expect(g[0]!.items).toHaveLength(2);
  });
  it('空陣列 → 空', () => expect(groupByYear([])).toEqual([]));
});
