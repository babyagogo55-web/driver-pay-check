import type { BackupFile, DailyRecord, DateStr, MapsSettings, Master, Stop, Template } from './types';
import { HIGHWAY_CARGO_ID } from './types';

// 初期値（すべて仮）。行き先名は聞き取りの文字起こしのまま「（仮）」を付けている。
// 本人に正式名称・単価を確認したら、設定画面から書き換える。

export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sampleMaster(): Master {
  const destinations = [
    { id: 'd1', name: '太田垣（仮）', aliases: ['おおたがき'], order: 1, active: true },
    { id: 'd2', name: '第一柿（仮）', aliases: ['だいいちかき'], order: 2, active: true },
    { id: 'd3', name: '東日本（仮）', aliases: ['ひがしにほん', 'ひがしにっぽん'], order: 3, active: true },
    { id: 'd4', name: '行き先D（仮）', order: 4, active: true },
    { id: 'd5', name: '行き先E（仮）', order: 5, active: true },
  ];
  const cargoTypes = [
    { id: 'c1', name: '青果（仮）', unit: '点', aliases: ['せいか'], order: 1, active: true },
    { id: 'c2', name: 'ケース物（仮）', unit: '点', aliases: ['ケース'], order: 2, active: true },
    { id: 'c3', name: 'パレット（仮）', unit: '枚', order: 3, active: true },
  ];
  const from = '2020-01-01';
  const base: Record<string, number[]> = {
    // [青果, ケース, パレット, 高速加算]
    d1: [30, 20, 300, 0],
    d2: [35, 25, 350, 0],
    d3: [40, 30, 400, 500],
    d4: [30, 20, 300, 0],
    d5: [45, 35, 450, 500],
  };
  const cols = ['c1', 'c2', 'c3', HIGHWAY_CARGO_ID];
  const unitPrices = Object.entries(base).flatMap(([d, prices]) =>
    prices.map((price, i) => ({ destinationId: d, cargoTypeId: cols[i], from, price })),
  );
  return {
    schemaVersion: 1,
    driverName: '',
    office: '',
    baseSalary: [{ from, value: 200000 }],
    distanceRateX100: [{ from, value: 500 }],
    destinations,
    cargoTypes,
    unitPrices,
    priceRevisions: [from],
    highwayMode: 'none',
    highwayInOperation: true,
    closingDay: 0,
    payDay: 0,
    rounding: 'floor',
    roundingTiming: 'daily',
    companyDailyBasis: 'operation',
    dayStartHour: 0,
    templates: [
      {
        id: 't1',
        name: 'いつもの便A（仮）',
        stops: [
          { destinationId: 'd1', items: [{ cargoTypeId: 'c1', count: 50 }], highway: false },
          { destinationId: 'd2', items: [{ cargoTypeId: 'c1', count: 30 }, { cargoTypeId: 'c2', count: 20 }], highway: false },
          { destinationId: 'd3', items: [{ cargoTypeId: 'c3', count: 4 }], highway: true },
        ],
        km10: 2800,
      },
    ],
    reminderTime: '07:00',
    maps: defaultMaps(),
    isSample: true,
  };
}

export function defaultMaps(): MapsSettings {
  return { officeAddress: '', roundTrip: true, apiKey: '', autoFill: false, tolerancePct: 15, cache: {} };
}

export function blankRecord(date: DateStr): DailyRecord {
  return { date, dayOff: false, stops: [], distance: { mode: 'direct', km10: null }, memo: '', updatedAt: '' };
}

export function newStop(destinationId = ''): Stop {
  return { id: newId('s'), destinationId, items: [], highway: false };
}

/** テンプレートを日の記録へ展開（行き先・荷物・点数・距離を入れる。メモは残す） */
export function applyTemplate(record: DailyRecord, t: Template): DailyRecord {
  return {
    ...record,
    dayOff: false,
    stops: t.stops.map((s) => ({ ...s, id: newId('s'), items: s.items.map((i) => ({ ...i })) })),
    distance: t.km10 !== null ? { mode: 'direct', km10: t.km10 } : record.distance,
  };
}

/** 前回の記録をコピー（距離はメーター値ではなく走行距離として写す。メモは写さない） */
export function copyFrom(record: DailyRecord, src: DailyRecord): DailyRecord {
  const km10 =
    src.distance.mode === 'direct'
      ? src.distance.km10
      : src.distance.start10 !== null && src.distance.end10 !== null
        ? src.distance.end10 - src.distance.start10
        : null;
  return {
    ...record,
    dayOff: src.dayOff,
    stops: src.stops.map((s) => ({ ...s, id: newId('s'), items: s.items.map((i) => ({ ...i })) })),
    distance: { mode: 'direct', km10 },
  };
}

export function templateFromRecord(record: DailyRecord, name: string): Template {
  const km10 = record.distance.mode === 'direct' ? record.distance.km10 : null;
  return {
    id: newId('t'),
    name,
    stops: record.stops.map(({ destinationId, items, highway }) => ({ destinationId, items: items.map((i) => ({ ...i })), highway })),
    km10,
  };
}

/** 記録に意味のある入力があるか（空の記録は保存しない） */
export function isEmptyRecord(r: DailyRecord): boolean {
  const noDistance =
    r.distance.mode === 'direct' ? r.distance.km10 === null : r.distance.start10 === null && r.distance.end10 === null;
  return !r.dayOff && r.stops.length === 0 && noDistance && r.memo.trim() === '' && !r.startTime && !r.endTime;
}

/** バックアップファイルの最低限の検査。問題があれば理由を返す */
export function validateBackup(data: unknown): { ok: true; value: BackupFile } | { ok: false; reason: string } {
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'ファイルの中身が読めません' };
  const b = data as Partial<BackupFile>;
  if (b.app !== 'driver-pay-check') return { ok: false, reason: 'このアプリのバックアップではありません' };
  if (b.schemaVersion !== 1) return { ok: false, reason: `対応していない版です（${String(b.schemaVersion)}）` };
  if (!b.master || !Array.isArray(b.records) || !Array.isArray(b.statements)) {
    return { ok: false, reason: '必要なデータが欠けています' };
  }
  for (const r of b.records) {
    if (typeof r?.date !== 'string' || !Array.isArray(r.stops)) return { ok: false, reason: '記録の形式が正しくありません' };
  }
  return { ok: true, value: b as BackupFile };
}
