import { describe, expect, it } from 'vitest';
import { calcDay, calcPeriod, distanceKm10, priceFor, resolveDated } from './calc';
import { addDays, datesInRange, isValidDate, periodOf, periodRange, todayStr } from './dates';
import { applyTemplate, blankRecord, copyFrom, isEmptyRecord, sampleMaster, templateFromRecord } from './defaults';
import { formatFixed, parseFixed, parseYen, roundDiv, signedYen } from './money';
import type { DailyRecord, Master } from './types';
import { HIGHWAY_CARGO_ID } from './types';

// テスト用の単純なマスタ：行き先A/B、荷物X/Y、距離5円/km
function master(over: Partial<Master> = {}): Master {
  return {
    ...sampleMaster(),
    isSample: false,
    destinations: [
      { id: 'A', name: '市場A', order: 1, active: true },
      { id: 'B', name: '市場B', order: 2, active: true },
    ],
    cargoTypes: [
      { id: 'X', name: '青果', unit: '点', order: 1, active: true },
      { id: 'Y', name: 'ケース', unit: '点', order: 2, active: true },
    ],
    unitPrices: [
      { destinationId: 'A', cargoTypeId: 'X', from: '2020-01-01', price: 30 },
      { destinationId: 'A', cargoTypeId: 'Y', from: '2020-01-01', price: 20 },
      { destinationId: 'B', cargoTypeId: 'X', from: '2020-01-01', price: 40 },
      // 2026-10-15 から値上げ
      { destinationId: 'A', cargoTypeId: 'X', from: '2026-10-15', price: 33 },
      { destinationId: 'B', cargoTypeId: HIGHWAY_CARGO_ID, from: '2020-01-01', price: 500 },
    ],
    baseSalary: [{ from: '2020-01-01', value: 200000 }],
    distanceRateX100: [{ from: '2020-01-01', value: 500 }],
    closingDay: 0,
    rounding: 'floor',
    roundingTiming: 'daily',
    highwayMode: 'none',
    highwayInOperation: true,
    templates: [],
    ...over,
  };
}

function rec(date: string, over: Partial<DailyRecord> = {}): DailyRecord {
  return { ...blankRecord(date), ...over };
}

const stop = (destinationId: string, items: [string, number][], highway = false) => ({
  id: `${destinationId}-${items.length}`,
  destinationId,
  items: items.map(([cargoTypeId, count]) => ({ cargoTypeId, count })),
  highway,
});

describe('roundDiv（整数の端数処理）', () => {
  it.each([
    [2500, 1000, 'floor', 2],
    [2500, 1000, 'round', 3],
    [2499, 1000, 'round', 2],
    [2001, 1000, 'ceil', 3],
    [2000, 1000, 'ceil', 2],
    [-2500, 1000, 'floor', -3],
    [-2500, 1000, 'ceil', -2],
    [-2500, 1000, 'round', -3],
    [0, 1000, 'ceil', 0],
  ] as const)('%i / %i (%s) = %i', (n, d, mode, want) => {
    expect(roundDiv(n, d, mode)).toBe(want);
  });
  it('小数を渡すとエラー（浮動小数点の混入を防ぐ）', () => {
    expect(() => roundDiv(1.5, 1, 'floor')).toThrow();
  });
});

describe('parseFixed / parseYen（入力の読み取り）', () => {
  it('小数1桁の距離', () => {
    expect(parseFixed('123.4', 1)).toBe(1234);
    expect(parseFixed('123', 1)).toBe(1230);
    expect(parseFixed('.5', 1)).toBe(5);
    expect(parseFixed('０．１', 1)).toBe(1);
  });
  it('桁あふれ・不正は null', () => {
    expect(parseFixed('1.23', 1)).toBeNull();
    expect(parseFixed('abc', 1)).toBeNull();
    expect(parseFixed('', 1)).toBeNull();
    expect(parseFixed('-', 1)).toBeNull();
  });
  it('0.1 + 0.2 のような浮動小数点誤差が出ない', () => {
    expect((parseFixed('0.1', 2) ?? 0) + (parseFixed('0.2', 2) ?? 0)).toBe(30);
  });
  it('円・カンマ・全角を読める', () => {
    expect(parseYen('１２，３４５円')).toBe(12345);
    expect(parseYen('-1,000')).toBe(-1000);
  });
  it('formatFixed は末尾の0を落とす', () => {
    expect(formatFixed(1230, 1)).toBe('123');
    expect(formatFixed(1234, 1)).toBe('123.4');
    expect(formatFixed(550, 2)).toBe('5.5');
  });
  it('signedYen', () => {
    expect(signedYen(1000)).toBe('+1,000円');
    expect(signedYen(-18000)).toBe('−18,000円');
    expect(signedYen(0)).toBe('±0円');
  });
});

describe('日付と締め日', () => {
  it('月末締め', () => {
    expect(periodOf('2026-10-31', 0)).toBe('2026-10');
    expect(periodRange('2026-02', 0)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRange('2028-02', 0)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
  it('20日締め：21日以降は翌月分', () => {
    expect(periodOf('2026-10-20', 20)).toBe('2026-10');
    expect(periodOf('2026-10-21', 20)).toBe('2026-11');
    expect(periodRange('2026-11', 20)).toEqual({ start: '2026-10-21', end: '2026-11-20' });
  });
  it('20日締めの年またぎ（12/21〜1/20 が1月分）', () => {
    expect(periodOf('2026-12-25', 20)).toBe('2027-01');
    expect(periodRange('2027-01', 20)).toEqual({ start: '2026-12-21', end: '2027-01-20' });
  });
  it('期間の日数', () => {
    expect(datesInRange('2026-10-21', '2026-11-20')).toHaveLength(31);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('夜間運行：朝4時前は前日の記録日', () => {
    expect(todayStr(new Date(2026, 9, 23, 3, 30), 4)).toBe('2026-10-22');
    expect(todayStr(new Date(2026, 9, 23, 4, 0), 4)).toBe('2026-10-23');
    expect(todayStr(new Date(2026, 9, 23, 3, 30), 0)).toBe('2026-10-23');
  });
  it('日付の妥当性', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
  });
});

describe('単価の適用期間（値上げ前後）', () => {
  const m = master();
  it('適用開始日の前日は旧単価、当日から新単価', () => {
    expect(priceFor(m, 'A', 'X', '2026-10-14')).toBe(30);
    expect(priceFor(m, 'A', 'X', '2026-10-15')).toBe(33);
    expect(priceFor(m, 'A', 'X', '2027-01-01')).toBe(33);
  });
  it('値上げしていない組み合わせは旧単価のまま', () => {
    expect(priceFor(m, 'A', 'Y', '2026-10-20')).toBe(20);
  });
  it('適用開始日より前・未登録は null', () => {
    expect(priceFor(m, 'A', 'X', '2019-12-31')).toBeNull();
    expect(priceFor(m, 'B', 'Y', '2026-10-20')).toBeNull();
  });
  it('resolveDated は登録順に関係なく一番新しい有効値', () => {
    const h = [
      { from: '2026-04-01', value: 3 },
      { from: '2020-01-01', value: 1 },
      { from: '2024-04-01', value: 2 },
    ];
    expect(resolveDated(h, '2025-01-01')).toBe(2);
    expect(resolveDated(h, '2026-04-01')).toBe(3);
  });
  it('同じ月の中で値上げをまたぐと、日ごとに正しい単価で合計される', () => {
    const records = [
      rec('2026-10-14', { stops: [stop('A', [['X', 10]])] }),
      rec('2026-10-15', { stops: [stop('A', [['X', 10]])] }),
    ];
    const r = calcPeriod(records, m, '2026-10');
    expect(r.cargoAllowance).toBe(300 + 330);
  });
});

describe('走行距離', () => {
  it('直接入力', () => {
    expect(distanceKm10({ mode: 'direct', km10: 1234 })).toEqual({ km10: 1234 });
  });
  it('メーター値の差から自動計算', () => {
    expect(distanceKm10({ mode: 'meter', start10: 1234560, end10: 1237365 })).toEqual({ km10: 2805 });
  });
  it('メーターが逆転していたら警告して距離0扱い', () => {
    const r = calcDay(rec('2026-10-01', { distance: { mode: 'meter', start10: 200, end10: 100 } }), master());
    expect(r.km10).toBeNull();
    expect(r.distanceAllowance).toBe(0);
    expect(r.warnings.join()).toContain('メーター');
  });
  it('距離手当 280.5km × 5円 = 1402.5円 → 切り捨て1402／四捨五入1403／切り上げ1403', () => {
    const r = rec('2026-10-01', { distance: { mode: 'direct', km10: 2805 } });
    expect(calcDay(r, master({ rounding: 'floor' })).distanceAllowance).toBe(1402);
    expect(calcDay(r, master({ rounding: 'round' })).distanceAllowance).toBe(1403);
    expect(calcDay(r, master({ rounding: 'ceil' })).distanceAllowance).toBe(1403);
  });
  it('距離単価 5.5円/km のような小数単価も誤差なし', () => {
    const r = rec('2026-10-01', { distance: { mode: 'direct', km10: 1001 } }); // 100.1km
    const m = master({ distanceRateX100: [{ from: '2020-01-01', value: 550 }], rounding: 'round' });
    expect(calcDay(r, m).distanceMilli).toBe(550550); // 550.55円
    expect(calcDay(r, m).distanceAllowance).toBe(551);
  });
  it('端数処理を日ごと／月合計で切り替え', () => {
    // 100.1km を2日：日ごと切り捨て 500+500=1000、月合計 1001円
    const records = [
      rec('2026-10-01', { distance: { mode: 'direct', km10: 1001 } }),
      rec('2026-10-02', { distance: { mode: 'direct', km10: 1001 } }),
    ];
    expect(calcPeriod(records, master({ roundingTiming: 'daily' }), '2026-10').distanceAllowance).toBe(1000);
    expect(calcPeriod(records, master({ roundingTiming: 'monthly' }), '2026-10').distanceAllowance).toBe(1001);
  });
  it('距離単価の値上げも日付で切り替わる', () => {
    const m = master({ distanceRateX100: [{ from: '2020-01-01', value: 500 }, { from: '2026-10-10', value: 600 }] });
    expect(calcDay(rec('2026-10-09', { distance: { mode: 'direct', km10: 1000 } }), m).distanceAllowance).toBe(500);
    expect(calcDay(rec('2026-10-10', { distance: { mode: 'direct', km10: 1000 } }), m).distanceAllowance).toBe(600);
  });
});

describe('1日の運行内容手当（複数の行き先）', () => {
  it('5箇所・複数荷物の合計', () => {
    const r = rec('2026-10-01', {
      stops: [
        stop('A', [['X', 50]]),
        stop('A', [['Y', 10]]),
        stop('B', [['X', 30]]),
        stop('B', [['X', 1]]),
        stop('A', [['X', 2], ['Y', 3]]),
      ],
      distance: { mode: 'direct', km10: 3000 },
    });
    const d = calcDay(r, master());
    // A×X: 50*30 + 2*30 = 1560, A×Y: 10*20 + 3*20 = 260, B×X: 31*40 = 1240
    expect(d.cargoAllowance).toBe(1560 + 260 + 1240);
    expect(d.distanceAllowance).toBe(1500);
    expect(d.total).toBe(3060 + 1500);
    expect(d.lines).toHaveLength(6);
    expect(d.warnings).toEqual([]);
  });
  it('単価未設定は0円で計算し、警告を出す', () => {
    const d = calcDay(rec('2026-10-01', { stops: [stop('B', [['Y', 5]])], distance: { mode: 'direct', km10: 10 } }), master());
    expect(d.cargoAllowance).toBe(0);
    expect(d.warnings.join()).toContain('単価未設定');
  });
  it('点数0の行は無視', () => {
    const d = calcDay(rec('2026-10-01', { stops: [stop('A', [['X', 0]])], distance: { mode: 'direct', km10: 10 } }), master());
    expect(d.lines).toHaveLength(0);
  });
  it('距離が未入力なら警告', () => {
    const d = calcDay(rec('2026-10-01', { stops: [stop('A', [['X', 1]])] }), master());
    expect(d.warnings).toContain('走行距離が未入力です');
  });
  it('休みの日は0円・警告なし', () => {
    const d = calcDay(rec('2026-10-01', { dayOff: true, stops: [stop('A', [['X', 99]])], distance: { mode: 'direct', km10: 100 } }), master());
    expect(d.total).toBe(0);
    expect(d.warnings).toEqual([]);
  });
});

describe('高速道路の扱い', () => {
  const r = rec('2026-10-01', { stops: [stop('B', [['X', 10]], true), stop('A', [['X', 1]], true)], distance: { mode: 'direct', km10: 0 } });
  it('加算なし設定では金額が変わらない', () => {
    expect(calcDay(r, master({ highwayMode: 'none' })).total).toBe(400 + 30);
  });
  it('行き先ごと加算：Bは500円、Aは未設定で警告', () => {
    const d = calcDay(r, master({ highwayMode: 'perStop' }));
    expect(d.highwayAllowance).toBe(500);
    expect(d.operationAllowance).toBe(430 + 500);
    expect(d.warnings.join()).toContain('高速加算の金額が未設定：市場A');
  });
  it('高速加算を運行内容手当に含めない設定でも総支給には入る', () => {
    const m = master({ highwayMode: 'perStop', highwayInOperation: false });
    const p = calcPeriod([r], m, '2026-10');
    expect(p.operationAllowance).toBe(430);
    expect(p.separateHighway).toBe(500);
    expect(p.gross).toBe(200000 + 430 + 500);
  });
});

describe('月の集計', () => {
  const m = master();
  const records = [
    rec('2026-09-30', { stops: [stop('A', [['X', 100]])], distance: { mode: 'direct', km10: 1000 } }), // 期間外
    rec('2026-10-01', { stops: [stop('A', [['X', 10]]), stop('B', [['X', 5]])], distance: { mode: 'direct', km10: 2000 } }),
    rec('2026-10-02', { dayOff: true }),
    rec('2026-10-03', { stops: [stop('A', [['Y', 4]])], distance: { mode: 'meter', start10: 100000, end10: 101505 } }),
    rec('2026-11-01', { stops: [stop('A', [['X', 100]])], distance: { mode: 'direct', km10: 1000 } }), // 期間外
  ];
  const p = calcPeriod(records, m, '2026-10', { today: '2026-10-05' });
  it('総支給 = 基本給 + 距離手当 + 運行内容手当', () => {
    // 距離：200km→1000円、150.5km→752円（切り捨て）
    expect(p.distanceAllowance).toBe(1752);
    // 10/1: 10*30 + 5*40 = 500、10/3: 4*20 = 80
    expect(p.operationAllowance).toBe(580);
    expect(p.gross).toBe(200000 + 1752 + 580);
    expect(p.km10Total).toBe(3505);
    expect(p.workDays).toBe(2);
  });
  it('行き先別・荷物種別別の内訳', () => {
    expect(p.byDestination.map((x) => [x.name, x.count, x.amount])).toEqual([
      ['市場A', 14, 380],
      ['市場B', 5, 200],
    ]);
    expect(p.byCargo.map((x) => [x.name, x.count, x.amount])).toEqual([
      ['青果', 15, 500],
      ['ケース', 4, 80],
    ]);
  });
  it('未入力の日は今日までだけ数える（休みは記録済み）', () => {
    expect(p.missingDates).toEqual(['2026-10-04', '2026-10-05']);
  });
  it('締め日をまたぐ：20日締めの11月分は 10/21〜11/20', () => {
    const p2 = calcPeriod(
      [
        rec('2026-10-20', { stops: [stop('A', [['Y', 1]])], distance: { mode: 'direct', km10: 0 } }),
        rec('2026-10-21', { stops: [stop('A', [['Y', 2]])], distance: { mode: 'direct', km10: 0 } }),
        rec('2026-11-20', { stops: [stop('A', [['Y', 3]])], distance: { mode: 'direct', km10: 0 } }),
        rec('2026-11-21', { stops: [stop('A', [['Y', 4]])], distance: { mode: 'direct', km10: 0 } }),
      ],
      master({ closingDay: 20 }),
      '2026-11',
    );
    expect(p2.days.map((d) => d.date)).toEqual(['2026-10-21', '2026-11-20']);
    expect(p2.operationAllowance).toBe(100);
  });
  it('基本給の改定は期間の締め日時点の額を使う', () => {
    const m2 = master({ baseSalary: [{ from: '2020-01-01', value: 200000 }, { from: '2026-10-10', value: 210000 }] });
    expect(calcPeriod([], m2, '2026-10').baseSalary).toBe(210000);
    expect(calcPeriod([], m2, '2026-09').baseSalary).toBe(200000);
  });
  it('控除の概算を引いた手取り目安', () => {
    const p3 = calcPeriod([], m, '2026-10', {
      statement: {
        period: '2026-10',
        baseSalary: null,
        distanceAllowance: null,
        operationAllowance: null,
        totalGross: null,
        daily: {},
        dayChecks: {},
        status: 'unchecked',
        note: '',
        deductions: [{ name: '所得税', amount: 5000 }, { name: '社会保険', amount: 30000 }],
        updatedAt: '',
      },
    });
    expect(p3.net).toBe(200000 - 35000);
  });
  it('基本給が未設定なら警告', () => {
    expect(calcPeriod([], master({ baseSalary: [] }), '2026-10').warnings[0].message).toContain('基本給');
  });
});

describe('テンプレート・コピー', () => {
  const m = sampleMaster();
  it('テンプレートを呼び出すと行き先・点数・距離が入る（メモは残る）', () => {
    const r = applyTemplate(rec('2026-10-23', { memo: '雨' }), m.templates[0]);
    expect(r.stops).toHaveLength(3);
    expect(r.memo).toBe('雨');
    expect(r.distance).toEqual({ mode: 'direct', km10: 2800 });
    // 元のテンプレートを書き換えない
    r.stops[0].items[0].count = 999;
    expect(m.templates[0].stops[0].items[0].count).toBe(50);
  });
  it('前回コピーはメーター値を走行距離として写し、メモは写さない', () => {
    const src = rec('2026-10-22', {
      stops: [stop('A', [['X', 3]])],
      distance: { mode: 'meter', start10: 1000, end10: 3500 },
      memo: '前日のメモ',
    });
    const r = copyFrom(rec('2026-10-23'), src);
    expect(r.distance).toEqual({ mode: 'direct', km10: 2500 });
    expect(r.memo).toBe('');
    expect(r.stops[0].id).not.toBe(src.stops[0].id);
  });
  it('今日の記録からテンプレート作成', () => {
    const t = templateFromRecord(rec('2026-10-23', { stops: [stop('A', [['X', 3]])], distance: { mode: 'direct', km10: 100 } }), '朝便');
    expect(t.stops[0]).toEqual({ destinationId: 'A', items: [{ cargoTypeId: 'X', count: 3 }], highway: false });
    expect(t.km10).toBe(100);
  });
  it('空の記録の判定', () => {
    expect(isEmptyRecord(rec('2026-10-23'))).toBe(true);
    expect(isEmptyRecord(rec('2026-10-23', { dayOff: true }))).toBe(false);
    expect(isEmptyRecord(rec('2026-10-23', { memo: 'x' }))).toBe(false);
  });
  it('サンプル初期値でも計算が通る', () => {
    const r = applyTemplate(rec('2026-10-23'), m.templates[0]);
    const d = calcDay(r, m);
    // 50*30 + 30*35 + 20*25 + 4*400 = 1500+1050+500+1600、距離280km=1400
    expect(d.cargoAllowance).toBe(4650);
    expect(d.distanceAllowance).toBe(1400);
    expect(d.warnings).toEqual([]);
    // 荷物ごとの数え方（パレット＝枚）が明細行に残る
    expect(d.lines.find((l) => l.cargoTypeId === 'c3')?.unit).toBe('枚');
  });
});
