import { describe, expect, it } from 'vitest';
import { calcDay, calcPeriod } from './calc';
import { blankRecord, sampleMaster } from './defaults';
import { distanceCheck, formatDuration, mapsLink, parseRoutes, planRoute, workMinutes } from './route';
import type { DailyRecord, Master } from './types';

const base = sampleMaster();
const m: Master = {
  ...base,
  destinations: base.destinations.map((d, i) => ({ ...d, address: ['山形市中央卸売市場', '仙台市中央卸売市場', '東京都中央卸売市場 大田市場'][i] })),
  maps: { ...base.maps, officeAddress: '山形県山形市 営業所', roundTrip: true },
};
const rec = (over: Partial<DailyRecord> = {}): DailyRecord => ({
  ...blankRecord('2026-10-23'),
  stops: [
    { id: 'a', destinationId: 'd1', items: [{ cargoTypeId: 'c1', count: 10 }], highway: false },
    { id: 'b', destinationId: 'd2', items: [], highway: false },
  ],
  ...over,
});

describe('道順を作る（Routes API への依頼内容）', () => {
  it('営業所 → 行き先 → 営業所（往復）、住所で指定、高速なし', () => {
    const p = planRoute(rec(), m);
    if ('error' in p) throw new Error(p.error);
    expect(p.body).toMatchObject({
      origin: { address: '山形県山形市 営業所' },
      intermediates: [{ address: '山形市中央卸売市場' }, { address: '仙台市中央卸売市場' }],
      destination: { address: '山形県山形市 営業所' },
      travelMode: 'DRIVE',
      routeModifiers: { avoidHighways: true },
    });
  });
  it('片道設定なら最後の行き先が終点', () => {
    const p = planRoute(rec(), { ...m, maps: { ...m.maps, roundTrip: false } });
    if ('error' in p) throw new Error(p.error);
    expect(p.body).toMatchObject({ destination: { address: '仙台市中央卸売市場' }, intermediates: [{ address: '山形市中央卸売市場' }] });
  });
  it('1か所でも高速なら高速ありで出す。道順が変わるとキーも変わる', () => {
    const a = planRoute(rec(), m);
    const b = planRoute(rec({ stops: [...rec().stops.slice(0, 1), { ...rec().stops[1], highway: true }] }), m);
    if ('error' in a || 'error' in b) throw new Error();
    expect(b.body).toMatchObject({ routeModifiers: { avoidHighways: false } });
    expect(a.key).not.toBe(b.key);
    // 点数が変わっても道順は同じ → 使い回せる
    const c = planRoute(rec({ stops: rec().stops.map((s) => ({ ...s, items: [{ cargoTypeId: 'c1', count: 99 }] })) }), m);
    if ('error' in c) throw new Error();
    expect(c.key).toBe(a.key);
  });
  it('送る内容に点数・金額・氏名が入らない', () => {
    const p = planRoute(rec(), { ...m, driverName: 'テスト太郎' });
    if ('error' in p) throw new Error();
    const sent = JSON.stringify(p.body);
    expect(sent).not.toContain('テスト太郎');
    expect(sent).not.toContain('青果');
    expect(sent).not.toContain('count');
  });
  it('住所未設定・営業所未設定・行き先なしは理由を返す', () => {
    expect(planRoute(rec({ stops: [{ id: 'x', destinationId: 'd4', items: [], highway: false }] }), m)).toEqual({
      error: expect.stringContaining('行き先D'),
    });
    expect(planRoute(rec(), { ...m, maps: { ...m.maps, officeAddress: '' } })).toEqual({ error: expect.stringContaining('営業所') });
    expect(planRoute(rec({ stops: [] }), m)).toEqual({ error: '行き先がありません' });
  });
  it('Googleマップを開くURL（キー不要）', () => {
    const u = new URL(mapsLink(['A営業所', '市場1', '市場2', 'A営業所']));
    expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/');
    expect(u.searchParams.get('api')).toBe('1');
    expect(u.searchParams.get('waypoints')).toBe('市場1|市場2');
    expect(u.searchParams.get('travelmode')).toBe('driving');
  });
});

describe('応答の読み取り', () => {
  it('メートル→0.1km（四捨五入）、"16500s"→秒', () => {
    expect(parseRoutes({ routes: [{ distanceMeters: 283449, duration: '16500s' }] })).toEqual({ km10: 2834, seconds: 16500 });
    expect(parseRoutes({ routes: [{ distanceMeters: 283450, duration: '1s' }] })).toEqual({ km10: 2835, seconds: 1 });
  });
  it('エラーをわかる言葉に', () => {
    expect(parseRoutes({ error: { status: 'PERMISSION_DENIED', message: 'x' } })).toEqual({ error: expect.stringContaining('APIキー') });
    expect(parseRoutes({})).toEqual({ error: expect.stringContaining('ルートが見つかりません') });
  });
});

describe('距離の打ち間違いチェック・時間', () => {
  it('15%以内は何も言わない、超えたら警告', () => {
    expect(distanceCheck(3200, 2834, 15)).toBeNull();
    expect(distanceCheck(3300, 2834, 15)).toContain('283.4km');
    expect(distanceCheck(280, 2834, 15)).toContain('打ち間違い'); // 280km を 28km と打った
    expect(distanceCheck(null, 2834, 15)).toBeNull();
    expect(distanceCheck(100, 2834, 0)).toBeNull();
  });
  it('記録に残した地図の目安は、同じ道順のときだけ照合に使う', () => {
    const p = planRoute(rec(), m);
    if ('error' in p) throw new Error();
    const r = rec({ distance: { mode: 'direct', km10: 280 }, mapRoute: { key: p.key, km10: 2834, seconds: 16500, at: '' } });
    const d = calcDay(r, m);
    expect(d.mapKm10).toBe(2834);
    expect(d.warnings.join()).toContain('地図の目安');
    // 行き先を変えたら古い目安は使わない
    const changed = calcDay({ ...r, stops: r.stops.slice(0, 1) }, m);
    expect(changed.mapKm10).toBeNull();
    expect(changed.warnings.join()).not.toContain('地図の目安');
  });
  it('拘束時間：日付またぎ・未入力', () => {
    expect(workMinutes('21:30', '05:15')).toBe(465);
    expect(workMinutes('08:00', '17:30')).toBe(570);
    expect(workMinutes('08:00', undefined)).toBeNull();
    expect(formatDuration(16500)).toBe('4時間35分');
    expect(formatDuration(600)).toBe('10分');
  });
  it('月の拘束時間の合計', () => {
    const p = calcPeriod(
      [rec({ date: '2026-10-01', startTime: '21:00', endTime: '05:00' }), rec({ date: '2026-10-02', startTime: '22:00', endTime: '04:30' })],
      m,
      '2026-10',
    );
    expect(p.workMinutesTotal).toBe(480 + 390);
  });
});
