import { datesInRange, periodRange } from './dates';
import { roundDiv } from './money';
import { distanceCheck, planRoute, workMinutes } from './route';
import type {
  DailyRecord,
  DateStr,
  Dated,
  DistanceInput,
  Master,
  PeriodStr,
  Statement,
} from './types';
import { HIGHWAY_CARGO_ID } from './types';

// 給与計算の本体。UIから切り離した純粋関数だけを置く（テストは calc.test.ts）。
// 単位：金額=円の整数、距離=0.1km単位の整数(km10)、距離単価=1/100円単位の整数(rateX100)。
// km10 × rateX100 は「1/1000円」単位になるので、1000で割るときにだけ端数処理をかける。

/** 適用開始日が date 以前で一番新しい値。なければ null */
export function resolveDated<T>(history: Dated<T>[], date: DateStr): T | null {
  let best: Dated<T> | null = null;
  for (const h of history) {
    if (h.from <= date && (best === null || h.from >= best.from)) best = h;
  }
  return best ? best.value : null;
}

/** 行き先×荷物種別の、その日に有効な単価。未設定なら null */
export function priceFor(
  master: Pick<Master, 'unitPrices'>,
  destinationId: string,
  cargoTypeId: string,
  date: DateStr,
): number | null {
  return resolveDated(
    master.unitPrices
      .filter((p) => p.destinationId === destinationId && p.cargoTypeId === cargoTypeId)
      .map((p) => ({ from: p.from, value: p.price })),
    date,
  );
}

/** 走行距離（0.1km単位）。未入力は null、メーターが逆転していれば null＋警告 */
export function distanceKm10(d: DistanceInput): { km10: number | null; warning?: string } {
  if (d.mode === 'direct') return { km10: d.km10 };
  if (d.start10 === null || d.end10 === null) return { km10: null };
  if (d.end10 < d.start10) {
    return { km10: null, warning: '帰着メーターが出発メーターより小さくなっています' };
  }
  return { km10: d.end10 - d.start10 };
}

export interface OperationLine {
  stopIndex: number;
  destinationId: string;
  destinationName: string;
  kind: 'cargo' | 'highway';
  cargoTypeId: string;
  cargoName: string;
  /** 数え方（点・枚・回など） */
  unit: string;
  count: number;
  unitPrice: number | null;
  amount: number;
}

export interface DayResult {
  date: DateStr;
  dayOff: boolean;
  km10: number | null;
  /** 距離手当（端数処理前、1/1000円単位） */
  distanceMilli: number;
  /** 距離手当（その日だけで端数処理した円） */
  distanceAllowance: number;
  distanceRateX100: number | null;
  lines: OperationLine[];
  /** 荷物の点数×単価の合計 */
  cargoAllowance: number;
  /** 高速利用の加算合計 */
  highwayAllowance: number;
  /** 会社の「運行内容手当」と比べる金額（設定で高速加算を含めるか切替） */
  operationAllowance: number;
  /** 距離手当＋荷物＋高速 */
  total: number;
  /** 出発〜帰着の拘束時間（分）。時刻を入れていなければ null */
  workMinutes: number | null;
  /** 今の道順で出した地図の目安（道順が変わっていたら null） */
  mapKm10: number | null;
  mapSeconds: number | null;
  warnings: string[];
}

export function calcDay(record: DailyRecord, master: Master): DayResult {
  const warnings: string[] = [];
  const date = record.date;
  const destName = (id: string) => master.destinations.find((x) => x.id === id)?.name ?? '（削除された行き先）';
  const cargoUnit = (id: string) => master.cargoTypes.find((x) => x.id === id)?.unit ?? '点';
  const cargoName = (id: string) =>
    id === HIGHWAY_CARGO_ID ? '高速加算' : master.cargoTypes.find((x) => x.id === id)?.name ?? '（削除された荷物）';

  const dist = distanceKm10(record.distance);
  if (dist.warning) warnings.push(dist.warning);
  const rateX100 = resolveDated(master.distanceRateX100, date);
  const km10 = record.dayOff ? null : dist.km10;
  if (!record.dayOff && record.stops.length > 0 && km10 === null && !dist.warning) {
    warnings.push('走行距離が未入力です');
  }
  if (km10 !== null && km10 > 0 && rateX100 === null) warnings.push('この日に有効な距離単価がありません');
  const distanceMilli = km10 !== null && rateX100 !== null ? km10 * rateX100 : 0;
  const distanceAllowance = roundDiv(distanceMilli, 1000, master.rounding);

  const lines: OperationLine[] = [];
  if (!record.dayOff) {
    record.stops.forEach((stop, i) => {
      if (!stop.destinationId) {
        warnings.push(`${i + 1}件目の行き先が選ばれていません`);
        return;
      }
      for (const item of stop.items) {
        if (!item.count) continue;
        const unitPrice = priceFor(master, stop.destinationId, item.cargoTypeId, date);
        if (unitPrice === null) {
          warnings.push(`単価未設定：${destName(stop.destinationId)} × ${cargoName(item.cargoTypeId)}`);
        }
        lines.push({
          stopIndex: i,
          destinationId: stop.destinationId,
          destinationName: destName(stop.destinationId),
          kind: 'cargo',
          cargoTypeId: item.cargoTypeId,
          cargoName: cargoName(item.cargoTypeId),
          unit: cargoUnit(item.cargoTypeId),
          count: item.count,
          unitPrice,
          amount: (unitPrice ?? 0) * item.count,
        });
      }
      if (stop.highway && master.highwayMode === 'perStop') {
        const unitPrice = priceFor(master, stop.destinationId, HIGHWAY_CARGO_ID, date);
        if (unitPrice === null) warnings.push(`高速加算の金額が未設定：${destName(stop.destinationId)}`);
        lines.push({
          stopIndex: i,
          destinationId: stop.destinationId,
          destinationName: destName(stop.destinationId),
          kind: 'highway',
          cargoTypeId: HIGHWAY_CARGO_ID,
          cargoName: '高速加算',
          unit: '回',
          count: 1,
          unitPrice,
          amount: unitPrice ?? 0,
        });
      }
    });
  }

  let mapKm10: number | null = null;
  let mapSeconds: number | null = null;
  if (record.mapRoute && !record.dayOff) {
    const plan = planRoute(record, master);
    if ('key' in plan && plan.key === record.mapRoute.key) {
      mapKm10 = record.mapRoute.km10;
      mapSeconds = record.mapRoute.seconds;
      const w = distanceCheck(km10, mapKm10, master.maps?.tolerancePct ?? 0);
      if (w) warnings.push(w);
    }
  }

  const cargoAllowance = sum(lines.filter((l) => l.kind === 'cargo').map((l) => l.amount));
  const highwayAllowance = sum(lines.filter((l) => l.kind === 'highway').map((l) => l.amount));
  const operationAllowance = cargoAllowance + (master.highwayInOperation ? highwayAllowance : 0);
  return {
    date,
    dayOff: record.dayOff,
    km10,
    distanceMilli,
    distanceAllowance,
    distanceRateX100: rateX100,
    lines,
    cargoAllowance,
    highwayAllowance,
    operationAllowance,
    total: distanceAllowance + cargoAllowance + highwayAllowance,
    workMinutes: record.dayOff ? null : workMinutes(record.startTime, record.endTime),
    mapKm10,
    mapSeconds,
    warnings,
  };
}

/** 会社明細の日別額と比べる自分側の金額 */
export function dayCompareValue(day: DayResult, master: Master): number {
  return master.companyDailyBasis === 'operationPlusDistance'
    ? day.operationAllowance + day.distanceAllowance
    : day.operationAllowance;
}

export interface BreakdownRow {
  key: string;
  name: string;
  unit: string;
  count: number;
  amount: number;
  /** 行き先別のときは荷物種別ごとの点数・金額 */
  detail: { key: string; name: string; unit: string; count: number; amount: number }[];
}

export interface PeriodResult {
  period: PeriodStr;
  start: DateStr;
  end: DateStr;
  days: DayResult[];
  /** 記録すべきなのに未入力の日（today 以前のみ） */
  missingDates: DateStr[];
  workDays: number;
  km10Total: number;
  /** 時刻を入れた日の拘束時間の合計（分） */
  workMinutesTotal: number;
  baseSalary: number;
  distanceAllowance: number;
  cargoAllowance: number;
  highwayAllowance: number;
  /** 会社の運行内容手当と比べる金額 */
  operationAllowance: number;
  /** 運行内容手当に含めない高速加算（highwayInOperation=false のときだけ） */
  separateHighway: number;
  gross: number;
  deductionsTotal: number;
  net: number;
  byDestination: BreakdownRow[];
  byCargo: BreakdownRow[];
  warnings: { date: DateStr; message: string }[];
}

export function calcPeriod(
  records: DailyRecord[],
  master: Master,
  period: PeriodStr,
  opts: { today?: DateStr; statement?: Statement | null } = {},
): PeriodResult {
  const { start, end } = periodRange(period, master.closingDay);
  const inRange = records.filter((r) => r.date >= start && r.date <= end).sort((a, b) => (a.date < b.date ? -1 : 1));
  const days = inRange.map((r) => calcDay(r, master));
  const recorded = new Set(inRange.map((r) => r.date));
  const lastCheck = opts.today && opts.today < end ? opts.today : end;
  const missingDates = datesInRange(start, end).filter((d) => d <= lastCheck && !recorded.has(d));

  const warnings: { date: DateStr; message: string }[] = [];
  for (const d of days) for (const w of d.warnings) warnings.push({ date: d.date, message: w });

  const base = resolveDated(master.baseSalary, end);
  if (base === null) warnings.push({ date: end, message: '基本給が未設定です' });
  const baseSalary = base ?? 0;

  const distanceAllowance =
    master.roundingTiming === 'monthly'
      ? roundDiv(sum(days.map((d) => d.distanceMilli)), 1000, master.rounding)
      : sum(days.map((d) => d.distanceAllowance));
  const cargoAllowance = sum(days.map((d) => d.cargoAllowance));
  const highwayAllowance = sum(days.map((d) => d.highwayAllowance));
  const operationAllowance = sum(days.map((d) => d.operationAllowance));
  const separateHighway = master.highwayInOperation ? 0 : highwayAllowance;
  const gross = baseSalary + distanceAllowance + operationAllowance + separateHighway;
  const deductionsTotal = sum((opts.statement?.deductions ?? []).map((x) => x.amount));

  const allLines = days.flatMap((d) => d.lines);
  const byDestination = group(allLines, (l) => l.destinationId, (l) => l.destinationName, (ls) =>
    group(ls, (l) => l.cargoTypeId, (l) => l.cargoName, () => []).map(({ key, name, unit, count, amount }) => ({
      key,
      name,
      unit,
      count,
      amount,
    })),
  );
  // 行き先の「点数」には高速加算の回数を混ぜない
  for (const row of byDestination) {
    row.count = sum(row.detail.filter((x) => x.key !== HIGHWAY_CARGO_ID).map((x) => x.count));
  }
  const byCargo = group(allLines, (l) => l.cargoTypeId, (l) => l.cargoName, () => []);
  const orderOf = (list: { id: string; order: number }[], id: string) => list.find((x) => x.id === id)?.order ?? 9999;
  byDestination.sort((a, b) => orderOf(master.destinations, a.key) - orderOf(master.destinations, b.key));
  byCargo.sort((a, b) => orderOf(master.cargoTypes, a.key) - orderOf(master.cargoTypes, b.key));

  return {
    period,
    start,
    end,
    days,
    missingDates,
    workDays: days.filter((d) => !d.dayOff && (d.lines.length > 0 || (d.km10 ?? 0) > 0)).length,
    km10Total: sum(days.map((d) => d.km10 ?? 0)),
    workMinutesTotal: sum(days.map((d) => d.workMinutes ?? 0)),
    baseSalary,
    distanceAllowance,
    cargoAllowance,
    highwayAllowance,
    operationAllowance,
    separateHighway,
    gross,
    deductionsTotal,
    net: gross - deductionsTotal,
    byDestination,
    byCargo,
    warnings,
  };
}

function group<L extends { count: number; amount: number; unit: string }>(
  lines: L[],
  keyOf: (l: L) => string,
  nameOf: (l: L) => string,
  detailOf: (ls: L[]) => BreakdownRow['detail'],
): BreakdownRow[] {
  const map = new Map<string, L[]>();
  for (const l of lines) {
    const k = keyOf(l);
    map.set(k, [...(map.get(k) ?? []), l]);
  }
  return [...map.entries()].map(([key, ls]) => ({
    key,
    name: nameOf(ls[0]),
    unit: ls[0].unit,
    count: sum(ls.map((l) => l.count)),
    amount: sum(ls.map((l) => l.amount)),
    detail: detailOf(ls),
  }));
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
