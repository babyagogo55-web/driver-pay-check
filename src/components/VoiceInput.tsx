import { useEffect, useRef, useState } from 'react';
import { applyVoice, parseVoice, type VoiceApply } from '../lib/voice';
import type { DailyRecord, Master } from '../lib/types';
import { useApp } from '../store';

// 話して入力。ボタンを押して話す → 話し終わると自動で記録に反映。
// ブラウザの音声認識が使えない端末では、入力欄でキーボードのマイクを使ってもらう。

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

const keyOf = (r: DailyRecord) => JSON.stringify([r.dayOff, r.stops, r.distance, r.memo]);

function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceInput({ record, onApply }: { record: DailyRecord; onApply: (r: DailyRecord) => void }) {
  const app = useApp();
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [result, setResult] = useState<VoiceApply | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [showBox, setShowBox] = useState(!Ctor);
  // 反映する前の記録。言い直し・呼び名登録のときはここからやり直すので、二重に足されない
  const before = useRef<DailyRecord | null>(null);
  const lastApplied = useRef('');
  const recRef = useRef<Recognition | null>(null);
  const finalText = useRef('');

  // 日付を変えたら結果表示を消す
  useEffect(() => {
    setResult(null);
    setUnknown([]);
    before.current = null;
  }, [record.date]);

  const run = (spoken: string, master: Master = app.master) => {
    const t = spoken.trim();
    if (!t) return;
    // 反映のあとで手で直していたら、その状態を新しい起点にする
    if (before.current && keyOf(record) !== lastApplied.current) before.current = null;
    const base = before.current ?? record;
    before.current = base;
    const p = parseVoice(t, master);
    const r = applyVoice(base, p, master);
    setUnknown(p.unknown);
    setResult(r);
    lastApplied.current = keyOf(r.record);
    onApply(r.record);
  };

  const start = () => {
    if (!Ctor) {
      setShowBox(true);
      return;
    }
    setError('');
    before.current = null;
    finalText.current = '';
    setInterim('');
    const rec = new Ctor();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText.current += r[0].transcript + ' ';
        else live += r[0].transcript;
      }
      setInterim(finalText.current + live);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('マイクが許可されていません。下の入力欄でキーボードのマイクを使ってください。');
        setShowBox(true);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError('音声が聞き取れませんでした（' + e.error + '）。もう一度押してください。');
      }
    };
    rec.onend = () => {
      setListening(false);
      const spoken = finalText.current.trim();
      setInterim('');
      if (spoken) {
        setText(spoken);
        run(spoken);
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setShowBox(true);
    }
  };

  const stop = () => recRef.current?.stop();

  const registerAlias = (word: string, kind: 'dest' | 'cargo', id: string) => {
    const add = <T extends { id: string; aliases?: string[] }>(xs: T[]) =>
      xs.map((x) => (x.id === id ? { ...x, aliases: [...new Set([...(x.aliases ?? []), word])] } : x));
    const next: Master =
      kind === 'dest' ? { ...app.master, destinations: add(app.master.destinations) } : { ...app.master, cargoTypes: add(app.master.cargoTypes) };
    app.updateMaster(() => next);
    run(text, next);
  };

  const undo = () => {
    if (before.current) onApply(before.current);
    before.current = null;
    setResult(null);
    setUnknown([]);
  };

  const dests = app.master.destinations.filter((d) => d.active).sort((a, b) => a.order - b.order);
  const cargos = app.master.cargoTypes.filter((c) => c.active).sort((a, b) => a.order - b.order);

  return (
    <section className="card voice">
      {!listening ? (
        <button type="button" className="btn big primary block voice-btn" onClick={start}>
          🎤 話して入力
        </button>
      ) : (
        <button type="button" className="btn big block voice-btn listening" onClick={stop}>
          ● 聞いています…（押すと終わり）
        </button>
      )}
      {listening && <p className="voice-live">{interim || '例：「太田垣 青果50、第一柿 ケース20、距離280キロ」'}</p>}
      {!listening && !result && (
        <p className="muted-text small">
          例：「いつもの便A、太田垣 青果55、距離290キロ」／「第一柿 ケース25」（その所だけ直ります）
        </p>
      )}
      {!listening && !showBox && (
        <button type="button" className="link small" onClick={() => setShowBox(true)}>
          文字で入れる（キーボードのマイクも使えます）
        </button>
      )}
      {error && <p className="warn-text small">{error}</p>}

      {result && (
        <div className="voice-result" aria-live="polite">
          <p className="ok-text">✓ 反映しました</p>
          <ul>
            {result.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          {result.warnings.map((w) => (
            <p key={w} className="warn-text small">
              ⚠ {w}
            </p>
          ))}
          {unknown.map((w) => (
            <div key={w} className="voice-unknown">
              <p className="small">
                「<b>{w}</b>」がわかりませんでした。これは？
              </p>
              <div className="chips">
                {dests.map((d) => (
                  <button key={d.id} type="button" className="chip" onClick={() => registerAlias(w, 'dest', d.id)}>
                    {d.name}
                  </button>
                ))}
                {cargos.map((c) => (
                  <button key={c.id} type="button" className="chip cargo" onClick={() => registerAlias(w, 'cargo', c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
              <p className="muted-text small">選ぶと、次からこの言い方でも通じます。</p>
            </div>
          ))}
          <div className="row-wrap">
            <button type="button" className="btn small" onClick={undo}>
              元に戻す
            </button>
            <button type="button" className="btn small" onClick={() => setShowBox(true)}>
              聞き取った文を直す
            </button>
          </div>
        </div>
      )}

      {showBox && (
        <div className="voice-box">
          <textarea
            className="memo"
            rows={3}
            value={text}
            placeholder={Ctor ? '聞き取った文がここに出ます。直して「反映」も可' : 'ここを押して、キーボードのマイクで話してください'}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn primary block" disabled={!text.trim()} onClick={() => run(text)}>
            反映
          </button>
        </div>
      )}
      {Ctor && <p className="muted-text tiny">※音声はスマホの音声認識サービス（Google・Apple）で文字にします。記録や金額は送りません。</p>}
    </section>
  );
}
