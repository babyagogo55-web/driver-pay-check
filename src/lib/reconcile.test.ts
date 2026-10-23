import { describe, expect, it } from 'vitest';
import { calcPeriod } from './calc';
import { blankRecord, sampleMaster, validateBackup } from './defaults';
import { emptyStatement, parseDailyPaste, reconcile } from './reconcile';
import { csvEscape, reconcileCsv, reconcileReportText, recordsCsv, reminderIcs } from './report';
import type { DailyRecord, Master, Statement } from './types';

const m: Master = {
  ...sampleMaster(),
  driverName: 'テスト太郎',
  destinations: [
    { id: 'A', name: '市場A', order: 1, active: true },
    { id: 'B', name: '市場B', order: 2, active: true },
  ],
  cargoTypes: [{ id: 'X', name: '青果', unit: '点', order: 1, active: true }],
  unitPrices: [
    { destinationId: 'A', cargoTypeId: 'X', from: '2020-01-01', price: 30 },
    { destinationId: 'B', cargoTypeId: 'X', from: '2020-01-01', price: 40 },
  ],
  baseSalary: [{ from: '2020-01-01', value: 200000 }],
  distanceRateX100: [{ from: '2020-01-01', value: 500 }],
  closingDay: 0,
  companyDailyBasis: 'operation',
};

const r = (date: string, dest: string, count: number, km10 = 1000): DailyRecord => ({
  ...blankRecord(date),
  stops: [{ id: date, destinationId: dest, items: [{ cargoTypeId: 'X', count }], highway: false }],
  distance: { mode: 'direct', km10 },
});

const records = [
  r('2026-10-01', 'A', 100), // 3000
  r('2026-10-02', 'B', 50), // 2000
  r('2026-10-03', 'A', 10), // 300
  { ...blankRecord('2026-10-04'), dayOff: true },
];

function st(over: Partial<Statement>): Statement {
  return { ...emptyStatement('2026-10'), ...over };
}

describe('照合（月合計）', () => {
  const p = calcPeriod(records, m, '2026-10');
  it('会社明細との差額を項目ごとに出す（会社−自分）', () => {
    const rec = reconcile(p, st({ baseSalary: 200000, distanceAllowance: 1500, operationAllowance: 4300, totalGross: 205800 }), m);
    const byKey = Object.fromEntries(rec.months.map((x) => [x.key, x]));
    expect(byKey.baseSalary.diff).toBe(0);
    expect(byKey.distanceAllowance.diff).toBe(0);
    expect(byKey.operationAllowance.mine).toBe(5300);
    expect(byKey.operationAllowance.diff).toBe(-1000);
    expect(byKey.totalGross.diff).toBe(-1000);
  });
  it('未入力の項目は差額なし（null）', () => {
    const rec = reconcile(p, st({}), m);
    expect(rec.months.every((x) => x.diff === null)).toBe(true);
    expect(rec.hasDaily).toBe(false);
    expect(rec.flaggedDays).toEqual([]);
  });
});

describe('照合（日別）', () => {
  const p = calcPeriod(records, m, '2026-10');
  it('差がある日・会社にしかない日・自分にしかない日を強調', () => {
    const rec = reconcile(
      p,
      st({
        daily: {
          '2026-10-01': 3000, // 一致
          '2026-10-02': 1000, // 会社が少ない（他人に入った疑い）
          '2026-10-05': 18000, // 自分は記録なし（他人の売上が入った疑い）
          // 10/3 は会社記載なし
        },
      }),
      m,
    );
    expect(rec.hasDaily).toBe(true);
    const f = Object.fromEntries(rec.flaggedDays.map((d) => [d.date, d]));
    expect(Object.keys(f).sort()).toEqual(['2026-10-02', '2026-10-03', '2026-10-05']);
    expect(f['2026-10-02'].diff).toBe(-1000);
    expect(f['2026-10-02'].reason).toBe('会社の記載が少ない');
    expect(f['2026-10-03'].diff).toBe(-300);
    expect(f['2026-10-03'].reason).toContain('会社の記載がない');
    expect(f['2026-10-05'].diff).toBe(18000);
    expect(f['2026-10-05'].mine).toBeNull();
    // 休みの日（0円）は会社記載なしでも要確認にしない
    expect(rec.days.find((d) => d.date === '2026-10-04')?.flagged).toBe(false);
    expect(rec.dailyDiffTotal).toBe(-1000 - 300 + 18000);
  });
  it('期間外の日別記載は無視', () => {
    const rec = reconcile(p, st({ daily: { '2026-11-01': 999 } }), m);
    expect(rec.hasDaily).toBe(false);
    expect(rec.days.find((d) => d.date === '2026-11-01')).toBeUndefined();
  });
  it('日別の比較対象に距離手当を含める設定', () => {
    const m2: Master = { ...m, companyDailyBasis: 'operationPlusDistance' };
    const rec = reconcile(calcPeriod(records, m2, '2026-10'), st({ daily: { '2026-10-01': 3500 } }), m2);
    expect(rec.days.find((d) => d.date === '2026-10-01')?.diff).toBe(0);
  });
});

describe('照合レポート出力', () => {
  const p = calcPeriod(records, m, '2026-10');
  const s = st({
    operationAllowance: 4300,
    daily: { '2026-10-01': 3000, '2026-10-02': 1000, '2026-10-03': 300 },
    dayChecks: { '2026-10-02': { status: 'inquiring', note: '本社に電話済み' } },
  });
  const rec = reconcile(p, s, m);
  it('テキストに日付・行き先・荷物・点数・単価・金額・差額が入る', () => {
    const t = reconcileReportText(p, rec, s, m);
    expect(t).toContain('2026年10月分');
    expect(t).toContain('テスト太郎');
    expect(t).toContain('10/2(金)');
    expect(t).toContain('市場B　青果　50点 × 40円 ＝ 2,000円');
    expect(t).toContain('差 −1,000円');
    expect(t).toContain('問い合わせ中　本社に電話済み');
    expect(t).not.toContain('10/1(木)');
  });
  it('CSVは1明細1行・BOM付き・要確認列あり', () => {
    const csv = reconcileCsv(rec);
    expect(csv.startsWith('﻿日付,行き先')).toBe(true);
    expect(csv).toContain('2026-10-02,市場B,青果,50,40,2000,2000,1000,-1000,要確認,会社の記載が少ない,問い合わせ中,本社に電話済み');
  });
  it('記録CSV', () => {
    const csv = recordsCsv(records, m);
    expect(csv).toContain('2026-10-01,,1,市場A,,青果,100,100,');
    expect(csv).toContain('2026-10-04,休み');
  });
  it('CSVのエスケープ', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape(null)).toBe('');
  });
});

describe('会社明細の日別金額の貼り付け', () => {
  const range = { start: '2026-09-21', end: '2026-10-20' };
  it('いろいろな書き方を読める', () => {
    const { values, errors } = parseDailyPaste(
      ['10/1 12,345', '2026-10-02,23456', '１０月３日　３４５６円', '25日(金) 1000', '9/30\t500', ''].join('\n'),
      range,
    );
    expect(errors).toEqual([]);
    expect(values).toEqual({
      '2026-10-01': 12345,
      '2026-10-02': 23456,
      '2026-10-03': 3456,
      '2026-09-25': 1000,
      '2026-09-30': 500,
    });
  });
  it('期間外・読めない行は errors に返す', () => {
    const { values, errors } = parseDailyPaste('10/25 100\nこんにちは\n10/5 円', range);
    expect(values).toEqual({});
    expect(errors).toHaveLength(3);
  });
});

describe('バックアップ・リマインダー', () => {
  it('バックアップ形式の検査', () => {
    expect(validateBackup({ app: 'driver-pay-check', schemaVersion: 1, master: m, records: [], statements: [] }).ok).toBe(true);
    expect(validateBackup({ app: 'other' }).ok).toBe(false);
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ app: 'driver-pay-check', schemaVersion: 2, master: m, records: [], statements: [] }).ok).toBe(false);
  });
  it('毎日の通知ファイル（.ics）', () => {
    const ics = reminderIcs('7:05', 'https://example.com/app/', new Date(2026, 9, 23, 12, 0));
    expect(ics).toContain('DTSTART:20261023T070500');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('BEGIN:VALARM');
  });
});
