import { calcDay, dayCompareValue, type DayResult, type PeriodResult } from './calc';
import { datesInRange } from './dates';
import { parseYen, toHalfWidth } from './money';
import type { DailyRecord, DateStr, DayCheck, Master, ReconcileStatus, Statement } from './types';

// 会社明細との照合。差額 = 会社記載額 − 自分の記録（プラス＝会社が多く払っている、マイナス＝不足の疑い）

export const STATUS_LABEL: Record<ReconcileStatus, string> = {
  unchecked: '未確認',
  match: '一致',
  inquiring: '問い合わせ中',
  nextMonth: '翌月加算予定',
  resolved: '解決済み',
  myMistake: '自分の記録ミス',
};

export interface MonthRow {
  key: 'baseSalary' | 'distanceAllowance' | 'operationAllowance' | 'totalGross';
  label: string;
  mine: number;
  company: number | null;
  diff: number | null;
}

export interface DayRow {
  date: DateStr;
  /** 自分の記録から出した比較額。記録がなければ null */
  mine: number | null;
  company: number | null;
  diff: number | null;
  /** 強調表示すべき日 */
  flagged: boolean;
  reason: string;
  day: DayResult | null;
  check: DayCheck;
}

export interface Reconciliation {
  months: MonthRow[];
  days: DayRow[];
  hasDaily: boolean;
  flaggedDays: DayRow[];
  /** 日別差額の合計（会社−自分） */
  dailyDiffTotal: number;
}

export function emptyStatement(period: string): Statement {
  return {
    period,
    baseSalary: null,
    distanceAllowance: null,
    operationAllowance: null,
    totalGross: null,
    daily: {},
    dayChecks: {},
    status: 'unchecked',
    note: '',
    deductions: [],
    updatedAt: '',
  };
}

export function reconcile(result: PeriodResult, statement: Statement, master: Master): Reconciliation {
  const mineOperation = result.operationAllowance;
  const months: MonthRow[] = [
    row('baseSalary', '基本給', result.baseSalary, statement.baseSalary),
    row('distanceAllowance', '距離手当', result.distanceAllowance, statement.distanceAllowance),
    row('operationAllowance', '運行内容手当', mineOperation, statement.operationAllowance),
    row('totalGross', '総支給額', result.gross, statement.totalGross),
  ];

  const hasDaily = Object.keys(statement.daily).some((d) => d >= result.start && d <= result.end);
  const byDate = new Map(result.days.map((d) => [d.date, d]));
  const days: DayRow[] = [];
  for (const date of datesInRange(result.start, result.end)) {
    const day = byDate.get(date) ?? null;
    const company = statement.daily[date] ?? null;
    const mine = day ? dayCompareValue(day, master) : null;
    const check = statement.dayChecks[date] ?? { status: 'unchecked', note: '' };
    if (day === null && company === null) continue;
    let flagged = false;
    let reason = '';
    if (company !== null && mine === null) {
      flagged = true;
      reason = '会社に記載があるが自分の記録がない';
    } else if (hasDaily && company === null && mine !== null && mine !== 0) {
      flagged = true;
      reason = '自分の記録にあるが会社の記載がない';
    } else if (company !== null && mine !== null && company !== mine) {
      flagged = true;
      reason = company > mine ? '会社の記載が多い' : '会社の記載が少ない';
    }
    const diff = company !== null || hasDaily ? (company ?? 0) - (mine ?? 0) : null;
    days.push({ date, mine, company, diff, flagged, reason, day, check });
  }
  const flaggedDays = days.filter((d) => d.flagged);
  return {
    months,
    days,
    hasDaily,
    flaggedDays,
    dailyDiffTotal: days.reduce((s, d) => s + (d.diff ?? 0), 0),
  };
}

function row(key: MonthRow['key'], label: string, mine: number, company: number | null): MonthRow {
  return { key, label, mine, company, diff: company === null ? null : company - mine };
}

/**
 * 会社アプリや明細から写した「日付と金額」の貼り付けを読み取る。
 * 対応例：'10/1 12,345' '2026-10-01,12345' '10月1日　12345円' '1日 12345'
 * 年は period（YYYY-MM）と期間の範囲から補う。読めなかった行は errors に返す。
 */
export function parseDailyPaste(
  text: string,
  range: { start: DateStr; end: DateStr },
): { values: Record<DateStr, number>; errors: string[] } {
  const values: Record<DateStr, number> = {};
  const errors: string[] = [];
  const candidates = datesInRange(range.start, range.end);
  for (const raw of text.split(/\r?\n/)) {
    const line = toHalfWidth(raw).trim();
    if (!line) continue;
    let y: number | null = null;
    let m: number | null = null;
    let d: number | null = null;
    let rest = '';
    let mt: RegExpExecArray | null;
    if ((mt = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?[\s,、\t:：]*(.*)$/.exec(line))) {
      [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
      rest = mt[4];
    } else if ((mt = /^(\d{1,2})[/月](\d{1,2})日?(?:\([^)]*\))?[\s,、\t:：]*(.*)$/.exec(line))) {
      [m, d] = [Number(mt[1]), Number(mt[2])];
      rest = mt[3];
    } else if ((mt = /^(\d{1,2})日(?:\([^)]*\))?[\s,、\t:：]*(.*)$/.exec(line))) {
      d = Number(mt[1]);
      rest = mt[2];
    } else {
      errors.push(`読めない行：${raw}`);
      continue;
    }
    const date = candidates.find((c) => {
      const [cy, cm, cd] = c.split('-').map(Number);
      return cd === d && (m === null || cm === m) && (y === null || cy === y);
    });
    const amountText = (/-?[\d,]+\s*円?/.exec(rest)?.[0] ?? '').trim();
    const amount = parseYen(amountText);
    if (!date) {
      errors.push(`期間外の日付：${raw}`);
    } else if (amount === null) {
      errors.push(`金額が読めない：${raw}`);
    } else {
      values[date] = amount;
    }
  }
  return { values, errors };
}

/** 記録1件の日別比較額だけほしいとき（カレンダー等） */
export function quickDayValue(record: DailyRecord, master: Master): number {
  return dayCompareValue(calcDay(record, master), master);
}
