import { useEffect, useState, type ReactNode } from 'react';
import { formatFixed, parseFixed } from '../lib/money';

// 大きな指でも押しやすい共通部品

/** − [数] + の点数入力。数字部分はタップするとテンキーが出る */
export function Stepper({ value, onChange, label, unit }: { value: number; onChange: (v: number) => void; label: string; unit?: string }) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <button type="button" className="step-btn" aria-label={`${label}を1減らす`} onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <IntInput value={value} onChange={(v) => onChange(v ?? 0)} ariaLabel={`${label}の${unit ?? '点数'}`} className="step-input" />
      <button type="button" className="step-btn" aria-label={`${label}を1増やす`} onClick={() => onChange(value + 1)}>
        ＋
      </button>
    </div>
  );
}

/** 整数入力（テンキー）。0 は空欄表示にして打ち直しやすくする */
export function IntInput({
  value,
  onChange,
  ariaLabel,
  className = 'num-input',
  placeholder,
  allowNegative = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  allowNegative?: boolean;
}) {
  return (
    <FixedInput
      value={value === 0 && !placeholder ? null : value}
      digits={0}
      onChange={(v) => onChange(v === null ? null : allowNegative ? v : Math.abs(v))}
      ariaLabel={ariaLabel}
      className={className}
      placeholder={placeholder ?? '0'}
      inputMode="numeric"
    />
  );
}

/** 小数を整数（×10^digits）で受け取る入力欄。打っている途中の文字列は保持する */
export function FixedInput({
  value,
  digits,
  onChange,
  ariaLabel,
  className = 'num-input',
  placeholder,
  inputMode = 'decimal',
}: {
  value: number | null;
  digits: number;
  onChange: (v: number | null) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric';
}) {
  const [text, setText] = useState(formatFixed(value, digits));
  useEffect(() => {
    // 外から値が変わったとき（テンプレート呼び出し等）だけ表示を合わせる
    if (parseFixed(text, digits) !== value) setText(formatFixed(value, digits));
  }, [value, digits]);
  const bad = text.trim() !== '' && parseFixed(text, digits) === null;
  return (
    <input
      className={className + (bad ? ' bad' : '')}
      type="text"
      inputMode={inputMode}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseFixed(e.target.value, digits);
        if (e.target.value.trim() === '') onChange(null);
        else if (v !== null) onChange(v);
      }}
    />
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className={'toggle' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="toggle-mark">{on ? '✓' : ''}</span>
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 2回押すと実行するボタン（確認ダイアログの代わり。誤タップ防止） */
export function ConfirmButton({ onConfirm, children, className = 'btn danger small' }: { onConfirm: () => void; children: ReactNode; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={className + (armed ? ' armed' : '')}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? 'もう一度押すと実行' : children}
    </button>
  );
}

export function PeriodNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="nav-row">
      <button type="button" className="nav-btn" aria-label="前へ" onClick={onPrev}>
        ◀
      </button>
      <div className="nav-label">{label}</div>
      <button type="button" className="nav-btn" aria-label="次へ" onClick={onNext}>
        ▶
      </button>
    </div>
  );
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 古い端末向け
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function useFlash(): [string, (msg: string) => void] {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 2500);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg];
}
