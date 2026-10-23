import type { DateStr, PeriodStr } from './types';

// 日付は 'YYYY-MM-DD' 文字列で扱い、計算時だけ UTC の Date に変換する（端末のタイムゾーンで日付がずれないように）

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(y: number, m: number, d: number): DateStr {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseDate(s: DateStr): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseDate(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(s: DateStr, n: number): DateStr {
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toDateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonths(p: PeriodStr, n: number): PeriodStr {
  const [y, m] = p.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

/** 曜日（0=日） */
export function weekday(s: DateStr): number {
  const { y, m, d } = parseDate(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 今日の記録日。dayStartHour より前（例：朝4時前）なら前日扱い */
export function todayStr(now: Date = new Date(), dayStartHour = 0): DateStr {
  const t = new Date(now.getTime());
  if (t.getHours() < dayStartHour) t.setDate(t.getDate() - 1);
  return toDateStr(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** その日が属する支給対象月。closingDay=0 は月末締め */
export function periodOf(date: DateStr, closingDay: number): PeriodStr {
  const { y, m, d } = parseDate(date);
  const base = `${y}-${pad(m)}`;
  if (closingDay === 0 || d <= closingDay) return base;
  return addMonths(base, 1);
}

/** 支給対象月の開始日と終了日（両端を含む） */
export function periodRange(period: PeriodStr, closingDay: number): { start: DateStr; end: DateStr } {
  const [y, m] = period.split('-').map(Number);
  if (closingDay === 0) {
    return { start: toDateStr(y, m, 1), end: toDateStr(y, m, daysInMonth(y, m)) };
  }
  const end = toDateStr(y, m, closingDay);
  const prev = addMonths(period, -1);
  const [py, pm] = prev.split('-').map(Number);
  return { start: toDateStr(py, pm, closingDay + 1), end };
}

export function datesInRange(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 表示用 '10/23(木)' */
export function shortJa(s: DateStr): string {
  const { m, d } = parseDate(s);
  return `${m}/${d}(${WEEKDAY_JA[weekday(s)]})`;
}

export function periodLabel(p: PeriodStr, closingDay: number): string {
  const [y, m] = p.split('-').map(Number);
  const { start, end } = periodRange(p, closingDay);
  const s = parseDate(start);
  const e = parseDate(end);
  return `${y}年${m}月分（${s.m}/${s.d}〜${e.m}/${e.d}）`;
}
