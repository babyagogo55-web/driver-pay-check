import type { RoundingMode } from './types';

/** 整数どうしの割り算を指定の端数処理で整数にする（負の数にも対応） */
export function roundDiv(n: number, d: number, mode: RoundingMode): number {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0) {
    throw new Error(`roundDiv: 整数でない値 n=${n} d=${d}`);
  }
  const sign = n < 0 ? -1 : 1;
  const a = Math.abs(n);
  const q = Math.floor(a / d);
  const r = a % d;
  if (r === 0) return sign * q;
  let up: boolean;
  if (mode === 'round') up = r * 2 >= d;
  else if (mode === 'ceil') up = sign > 0;
  else up = sign < 0; // floor：負の数は絶対値を切り上げ
  return sign * (up ? q + 1 : q);
}

/**
 * '123.4' のような10進文字列を、小数点以下 digits 桁の整数に変換する（浮動小数点を通さない）。
 * 桁が多すぎる・数でない場合は null。
 */
export function parseFixed(input: string, digits: number): number | null {
  const s = toHalfWidth(input).trim().replace(/,/g, '');
  if (s === '') return null;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  if (frac.length > digits) return null;
  const v = Number(m[2] || '0') * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
  return m[1] === '-' ? -v : v;
}

export function formatFixed(v: number | null, digits: number): string {
  if (v === null) return '';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  const p = 10 ** digits;
  const i = Math.floor(a / p);
  const f = a % p;
  if (digits === 0 || f === 0) return sign + String(i);
  return sign + String(i) + '.' + String(f).padStart(digits, '0').replace(/0+$/, '');
}

/** 全角数字・記号を半角へ（音声入力・日本語キーボード対策） */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９．，－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ー−]/g, '-');
}

export function parseYen(input: string): number | null {
  return parseFixed(input.replace(/円/g, ''), 0);
}

export function yen(v: number): string {
  return v.toLocaleString('ja-JP') + '円';
}

/** 差額表示用。+1,000円 / −1,000円 / ±0円 */
export function signedYen(v: number): string {
  if (v === 0) return '±0円';
  return (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('ja-JP') + '円';
}

export function km(km10: number): string {
  return formatFixed(km10, 1) + 'km';
}
