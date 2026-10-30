import { useRef, useState, type ReactNode } from 'react';
import { ConfirmButton, FixedInput, IntInput, Segmented, Toggle, download, useFlash } from '../components/ui';
import * as db from '../db';
import { fetchRoute } from '../maps';
import { priceFor, resolveDated } from '../lib/calc';
import { isValidDate } from '../lib/dates';
import { blankMaster, newId, validateBackup } from '../lib/defaults';
import { formatFixed } from '../lib/money';
import { recordsCsv, reminderIcs } from '../lib/report';
import type { BackupFile, Dated, Master } from '../lib/types';
import { HIGHWAY_CARGO_ID } from '../lib/types';
import { useApp } from '../store';

// 設定（マスタ）。不明な値はすべてここで後から直せるようにしてある。

export function SettingsScreen() {
  const app = useApp();
  const { master } = app;
  const up = (patch: Partial<Master>) => app.updateMaster((m) => ({ ...m, ...patch }));
  const [flash, setFlash] = useFlash();

  return (
    <div className="screen settings">
      {master.isSample && (
        <div className="banner warn">
          今は<b>見本の値</b>で試しています（金額は本物ではありません）。
          <ConfirmButton className="btn small primary" onConfirm={() => void app.resetAll(blankMaster())}>
            見本と試しの記録を消して、自分の値で始める
          </ConfirmButton>
          <ConfirmButton className="btn small" onConfirm={() => up({ isSample: false })}>
            見本を自分で書き換えた（注意表示を消す）
          </ConfirmButton>
        </div>
      )}

      <button type="button" className="btn block" onClick={() => up({ setupDone: false })}>
        はじめの設定を順番に開く（基本給・単価など）
      </button>

      <Section title="あなたの情報">
        <label className="field">
          <span>氏名（レポートに載ります）</span>
          <input className="text-input" value={master.driverName} onChange={(e) => up({ driverName: e.target.value })} />
        </label>
        <label className="field">
          <span>営業所</span>
          <input className="text-input" value={master.office} onChange={(e) => up({ office: e.target.value })} />
        </label>
      </Section>

      <Section title="基本給（月額）">
        <DatedEditor
          history={master.baseSalary}
          onChange={(baseSalary) => up({ baseSalary })}
          render={(v, set) => <IntInput value={v} ariaLabel="基本給" onChange={(x) => set(x ?? 0)} className="num-input wide" />}
          unit="円"
          defaultValue={resolveDated(master.baseSalary, '9999-12-31') ?? 0}
        />
      </Section>

      <Section title="距離手当の単価">
        <DatedEditor
          history={master.distanceRateX100}
          onChange={(distanceRateX100) => up({ distanceRateX100 })}
          render={(v, set) => <FixedInput value={v} digits={2} ariaLabel="1kmあたりの円" onChange={(x) => set(x ?? 0)} />}
          unit="円 / 1km"
          defaultValue={resolveDated(master.distanceRateX100, '9999-12-31') ?? 500}
        />
      </Section>

      <Section title="行き先">
        <ListEditor
          items={master.destinations}
          onChange={(destinations) => up({ destinations })}
          make={(order) => ({ id: newId('d'), name: '新しい行き先', order, active: true })}
          extra={(d, set) => (
            <input
              className="text-input alias-input"
              aria-label="住所（Googleマップ用）"
              placeholder="住所・施設名（地図用）"
              value={d.address ?? ''}
              onChange={(e) => set({ ...d, address: e.target.value })}
            />
          )}
        />
      </Section>

      <Section title="荷物の種類">
        <ListEditor
          items={master.cargoTypes}
          onChange={(cargoTypes) => up({ cargoTypes })}
          make={(order) => ({ id: newId('c'), name: '新しい荷物', unit: '点', order, active: true })}
          extra={(c, set) => (
            <input className="text-input unit-input" aria-label="単位" value={c.unit} onChange={(e) => set({ ...c, unit: e.target.value })} />
          )}
        />
      </Section>

      <Section title="高速道路を使ったとき">
        <Segmented
          value={master.highwayMode}
          options={[
            { value: 'none', label: '手当は変わらない' },
            { value: 'perStop', label: '行き先ごとに加算' },
          ]}
          onChange={(highwayMode) => up({ highwayMode })}
        />
        {master.highwayMode === 'perStop' && (
          <>
            <p className="muted-text small">加算額は下の「単価表」の「高速加算」欄に入れます。</p>
            <Toggle on={master.highwayInOperation} onChange={(highwayInOperation) => up({ highwayInOperation })}>
              高速加算は「運行内容手当」に含まれる
            </Toggle>
          </>
        )}
      </Section>

      <Section title="単価表（行き先 × 荷物）" open>
        <PriceTable />
      </Section>

      <Section title="締め日・端数">
        <label className="field">
          <span>締め日</span>
          <select value={master.closingDay} onChange={(e) => up({ closingDay: Number(e.target.value) })}>
            <option value={0}>月末締め</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}日締め
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>支給日（メモ）</span>
          <select value={master.payDay} onChange={(e) => up({ payDay: Number(e.target.value) })}>
            <option value={0}>未設定</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}日
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>距離手当の1円未満</span>
          <Segmented
            value={master.rounding}
            options={[
              { value: 'floor', label: '切り捨て' },
              { value: 'round', label: '四捨五入' },
              { value: 'ceil', label: '切り上げ' },
            ]}
            onChange={(rounding) => up({ rounding })}
          />
        </div>
        <div className="field">
          <span>端数を処理するのは</span>
          <Segmented
            value={master.roundingTiming}
            options={[
              { value: 'daily', label: '1日ごと' },
              { value: 'monthly', label: '月の合計で' },
            ]}
            onChange={(roundingTiming) => up({ roundingTiming })}
          />
        </div>
        <label className="field">
          <span>夜中の運行：この時刻より前に開いたら前日の記録にする</span>
          <select value={master.dayStartHour} onChange={(e) => up({ dayStartHour: Number(e.target.value) })}>
            <option value={0}>使わない（0時で切替）</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                朝{h}時より前は前日
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>会社明細の「日ごとの金額」の中身</span>
          <Segmented
            value={master.companyDailyBasis}
            options={[
              { value: 'operation', label: '運行内容手当だけ' },
              { value: 'operationPlusDistance', label: '距離手当も含む' },
            ]}
            onChange={(companyDailyBasis) => up({ companyDailyBasis })}
          />
        </div>
      </Section>

      <Section title="いつものルート（テンプレート）">
        <p className="muted-text small">新しく作るときは、記録画面で1日分を入れてから「いつものルートに登録」を押します。</p>
        {master.templates.map((t, i) => (
          <div key={t.id} className="list-row">
            <input
              className="text-input"
              value={t.name}
              aria-label="テンプレートの名前"
              onChange={(e) => up({ templates: master.templates.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)) })}
            />
            <button type="button" className="btn small" disabled={i === 0} aria-label="上へ" onClick={() => up({ templates: move(master.templates, i, -1) })}>
              ↑
            </button>
            <ConfirmButton onConfirm={() => up({ templates: master.templates.filter((x) => x.id !== t.id) })}>消す</ConfirmButton>
            <div className="muted-text small full">
              {t.stops.map((s) => master.destinations.find((d) => d.id === s.destinationId)?.name ?? '?').join(' → ')}
              {t.km10 !== null ? `／${formatFixed(t.km10, 1)}km` : ''}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Googleマップ連携（任意）">
        <MapsSettingsBox />
      </Section>

      <Section title="記録忘れ防止">
        <p className="small">
          ホーム画面に置いたアプリは、仕組み上「決まった時刻に自分から通知を出す」ことができません。代わりに、スマホのカレンダーに毎日の通知を入れます。
        </p>
        <label className="field">
          <span>通知する時刻</span>
          <input type="time" className="text-input" value={master.reminderTime} onChange={(e) => up({ reminderTime: e.target.value })} />
        </label>
        <button
          type="button"
          className="btn primary"
          onClick={() => download('日報リマインダー.ics', reminderIcs(master.reminderTime || '07:00', location.href.split('#')[0]), 'text/calendar')}
        >
          カレンダーに毎日の通知を追加
        </button>
        <p className="muted-text small">ファイルを開くと「カレンダーに追加」と出ます。ほかに、スマホの目覚まし（アラーム）に「日報」と名前を付けておく方法もあります。</p>
      </Section>

      <Section title="バックアップ・機種変更">
        <BackupBox onDone={setFlash} />
        <button
          type="button"
          className="btn"
          onClick={() => download('運行記録_全期間.csv', recordsCsv(Object.values(app.records), master), 'text/csv')}
        >
          全部の記録をCSVで保存
        </button>
      </Section>

      <p className="muted-text small center">データはこのスマホの中だけに保存され、外には送られません。</p>
      {flash && <div className="flash">{flash}</div>}
    </div>
  );
}

export function MapsSettingsBox() {
  const app = useApp();
  const { maps } = app.master;
  const set = (patch: Partial<typeof maps>) => app.updateMaster((m) => ({ ...m, maps: { ...m.maps, ...patch } }));
  const [test, setTest] = useState('');
  const cached = Object.keys(maps.cache).length;
  return (
    <div>
      <MapsOptionalNote />
      <p className="small">
        行き先の住所（「行き先」の欄）と営業所の住所を入れると、その日のルートの<b>距離と運転時間の目安</b>が出ます。キーがなくても「Googleマップでルートを見る」は使えます。
      </p>
      <label className="field">
        <span>営業所の住所</span>
        <input className="text-input" placeholder="例：山形県山形市○○町1-2-3" value={maps.officeAddress} onChange={(e) => set({ officeAddress: e.target.value })} />
      </label>
      <Toggle on={maps.roundTrip} onChange={(roundTrip) => set({ roundTrip })}>
        最後に営業所へ戻るまでを距離に入れる
      </Toggle>
      <label className="field">
        <span>APIキー（自動で出す場合）</span>
        <input
          className="text-input"
          type="password"
          autoComplete="off"
          placeholder="Google Cloud で作ったキー"
          value={maps.apiKey}
          onChange={(e) => set({ apiKey: e.target.value.trim() })}
        />
      </label>
      <Toggle on={maps.autoFill} onChange={(autoFill) => set({ autoFill })}>
        距離が空なら、地図の距離を自動で入れる
      </Toggle>
      <label className="field">
        <span>入力した距離と地図がこれ以上違えば注意を出す</span>
        <select value={maps.tolerancePct} onChange={(e) => set({ tolerancePct: Number(e.target.value) })}>
          <option value={0}>注意しない</option>
          {[10, 15, 20, 30].map((p) => (
            <option key={p} value={p}>
              {p}%
            </option>
          ))}
        </select>
      </label>
      {maps.apiKey && maps.officeAddress && (
        <div className="row-wrap">
          <button
            type="button"
            className="btn small"
            onClick={async () => {
              const dest = app.master.destinations.find((d) => d.active && d.address?.trim());
              if (!dest) return setTest('住所を入れた行き先がありません');
              setTest('確認中…');
              const r = await fetchRoute(maps.apiKey, {
                key: 'test',
                link: '',
                body: { origin: { address: maps.officeAddress }, destination: { address: dest.address }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'ja', units: 'METRIC' },
              });
              setTest('error' in r ? '✗ ' + r.error : `✓ つながりました（営業所→${dest.name}：${r.km10 / 10}km）`);
            }}
          >
            接続テスト
          </button>
          {cached > 0 && (
            <ConfirmButton className="btn small" onConfirm={() => set({ cache: {} })}>
              覚えたルート{cached}件を消す
            </ConfirmButton>
          )}
        </div>
      )}
      {test && <p className="small">{test}</p>}
      <details>
        <summary>APIキーの作り方（一度だけ・パソコンで）</summary>
        <ol className="small">
          <li>Google Cloud（console.cloud.google.com）にGoogleアカウントで入り、新しいプロジェクトを作る</li>
          <li>「お支払い」を設定する（カード登録が必要。月の無料枠内なら請求は0円）</li>
          <li>「APIとサービス」→「ライブラリ」で <b>Routes API</b> を有効にする</li>
          <li>「認証情報」→「APIキーを作成」</li>
          <li>
            キーの制限：<b>アプリケーションの制限＝ウェブサイト</b>にしてこのアプリのアドレスを登録、<b>APIの制限＝Routes API だけ</b>
          </li>
          <li>「予算とアラート」で月の予算（例：100円）を設定しておくと安心</li>
          <li>できたキーを上の欄に貼る</li>
        </ol>
        <p className="muted-text small">同じ道順は一度出せばこのスマホが覚えるので、毎日使っても問い合わせは道順が変わった日だけです。キーはこのスマホにだけ保存し、バックアップファイルには入りません。</p>
      </details>
      <p className="muted-text tiny">地図に送るのは営業所・行き先の住所と高速の有無だけです。給与・点数・氏名は送りません。</p>
    </div>
  );
}

/** 地図連携は使うかどうか本人が決める。使わなくても記録・計算・照合はすべてできる */
export function MapsOptionalNote() {
  return (
    <div className="banner info">
      <b>使うかどうかは、あなたの自由です（任意）。</b>
      <ul className="small">
        <li>使わなくても、記録・給料の計算・明細との照合はすべてできます。</li>
        <li>住所だけ入れれば、APIキーなしで「Googleマップでルートを見る」が使えます（無料）。</li>
        <li>距離と時間を自動で出すには、ご自身でGoogle Cloudに登録してAPIキーを作ります。カードの登録が必要です（無料枠の範囲なら0円）。</li>
        <li>地図に送るのは住所と高速の有無だけです。給料・点数・氏名は送りません。</li>
      </ul>
    </div>
  );
}

function Section({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="card section" open={open}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function move<T>(xs: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 適用開始日つきの値の一覧（値上げ・昇給の履歴） */
function DatedEditor({
  history,
  onChange,
  render,
  unit,
  defaultValue,
}: {
  history: Dated<number>[];
  onChange: (h: Dated<number>[]) => void;
  render: (v: number, set: (v: number) => void) => ReactNode;
  unit: string;
  defaultValue: number;
}) {
  const [newFrom, setNewFrom] = useState('');
  const sorted = [...history].sort((a, b) => (a.from < b.from ? -1 : 1));
  return (
    <div>
      {sorted.map((h) => (
        <div key={h.from} className="list-row">
          <span className="from">{h.from.replace(/-/g, '/')} から</span>
          {render(h.value, (v) => onChange(history.map((x) => (x.from === h.from ? { ...x, value: v } : x))))}
          <span className="unit">{unit}</span>
          {history.length > 1 && <ConfirmButton onConfirm={() => onChange(history.filter((x) => x.from !== h.from))}>消す</ConfirmButton>}
        </div>
      ))}
      <div className="field-row wrap">
        <input type="date" className="text-input" value={newFrom} aria-label="新しい適用開始日" onChange={(e) => setNewFrom(e.target.value)} />
        <button
          type="button"
          className="btn small"
          disabled={!isValidDate(newFrom) || history.some((x) => x.from === newFrom)}
          onClick={() => {
            onChange([...history, { from: newFrom, value: defaultValue }]);
            setNewFrom('');
          }}
        >
          この日から変更
        </button>
      </div>
    </div>
  );
}

interface Listable {
  id: string;
  name: string;
  aliases?: string[];
  order: number;
  active: boolean;
}

export function ListEditor<T extends Listable>({
  items,
  onChange,
  make,
  extra,
}: {
  items: T[];
  onChange: (xs: T[]) => void;
  make: (order: number) => T;
  extra?: (x: T, set: (x: T) => void) => ReactNode;
}) {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const renumber = (xs: T[]) => xs.map((x, i) => ({ ...x, order: i + 1 }));
  const set = (x: T) => onChange(items.map((y) => (y.id === x.id ? x : y)));
  return (
    <div>
      {sorted.map((x, i) => (
        <div key={x.id} className={'list-row' + (x.active ? '' : ' inactive')}>
          <input className="text-input" value={x.name} aria-label="名前" placeholder="名前" onChange={(e) => set({ ...x, name: e.target.value })} />
          {extra?.(x, set)}
          <AliasInput value={x.aliases ?? []} onChange={(aliases) => set({ ...x, aliases })} />
          <button type="button" className="btn small" disabled={i === 0} aria-label="上へ" onClick={() => onChange(renumber(move(sorted, i, -1)))}>
            ↑
          </button>
          <button type="button" className="btn small" onClick={() => set({ ...x, active: !x.active })}>
            {x.active ? '使う' : '使わない'}
          </button>
        </div>
      ))}
      <p className="muted-text small">使わなくなったものは「使わない」にします（過去の記録の計算には残ります）。</p>
      <p className="muted-text small">「呼び名」は音声入力用です。読み仮名や、よく聞き間違えられる書き方を「、」で区切って入れます（例：おおたがき、大田垣）。</p>
      <button type="button" className="btn small" onClick={() => onChange([...items, make(items.length + 1)])}>
        ＋ 追加
      </button>
    </div>
  );
}

/** 呼び名（、区切り）。打っている途中の文字は保持する */
function AliasInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('、'));
  return (
    <input
      className="text-input alias-input"
      aria-label="呼び名（音声入力用）"
      placeholder="呼び名（音声用）"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean));
      }}
    />
  );
}

/** 単価表。改定日ごとに「その日から変わった単価」だけを入れる。空欄は前の単価を引き継ぐ */
export function PriceTable() {
  const app = useApp();
  const { master } = app;
  const revisions = [...new Set([...master.priceRevisions, ...master.unitPrices.map((p) => p.from)])].sort();
  const [rev, setRev] = useState(revisions[revisions.length - 1] ?? '');
  const [newRev, setNewRev] = useState('');
  const cols = [
    ...master.cargoTypes.filter((c) => c.active).sort((a, b) => a.order - b.order),
    ...(master.highwayMode === 'perStop' ? [{ id: HIGHWAY_CARGO_ID, name: '高速加算', unit: '回' }] : []),
  ];
  const dests = master.destinations.filter((d) => d.active).sort((a, b) => a.order - b.order);
  const prevDay = (d: string) => {
    const t = new Date(d + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  };

  const setPrice = (destinationId: string, cargoTypeId: string, price: number | null) =>
    app.updateMaster((m) => {
      const rest = m.unitPrices.filter((p) => !(p.destinationId === destinationId && p.cargoTypeId === cargoTypeId && p.from === rev));
      return { ...m, unitPrices: price === null ? rest : [...rest, { destinationId, cargoTypeId, from: rev, price }] };
    });

  if (!rev) return <p>改定日がありません。下で追加してください。</p>;
  return (
    <div>
      <label className="field">
        <span>いつからの単価か</span>
        <select value={rev} onChange={(e) => setRev(e.target.value)}>
          {revisions.map((r) => (
            <option key={r} value={r}>
              {r.replace(/-/g, '/')} から
            </option>
          ))}
        </select>
      </label>
      <p className="muted-text small">空欄は前の単価のまま（薄い数字）。値上げした所だけ入れればよいです。</p>
      {dests.map((d) => (
        <div key={d.id} className="price-card">
          <h3>{d.name}</h3>
          {cols.map((c) => {
            const exact = master.unitPrices.find((p) => p.destinationId === d.id && p.cargoTypeId === c.id && p.from === rev);
            const inherited = priceFor(master, d.id, c.id, prevDay(rev));
            return (
              <div key={c.id} className="price-row">
                <span>{c.name}</span>
                <IntInput
                  value={exact?.price ?? null}
                  placeholder={inherited === null ? '未設定' : String(inherited)}
                  ariaLabel={`${d.name}の${c.name}の単価`}
                  onChange={(v) => setPrice(d.id, c.id, v)}
                />
                <span className="unit">円/{c.unit}</span>
              </div>
            );
          })}
        </div>
      ))}
      <div className="field-row wrap">
        <input type="date" className="text-input" value={newRev} aria-label="値上げの適用開始日" onChange={(e) => setNewRev(e.target.value)} />
        <button
          type="button"
          className="btn small primary"
          disabled={!isValidDate(newRev) || revisions.includes(newRev)}
          onClick={() => {
            app.updateMaster((m) => ({ ...m, priceRevisions: [...m.priceRevisions, newRev] }));
            setRev(newRev);
            setNewRev('');
          }}
        >
          値上げを登録（この日から）
        </button>
      </div>
      {revisions.length > 1 && (
        <ConfirmButton
          onConfirm={() => {
            app.updateMaster((m) => ({
              ...m,
              priceRevisions: m.priceRevisions.filter((r) => r !== rev),
              unitPrices: m.unitPrices.filter((p) => p.from !== rev),
            }));
            setRev(revisions.filter((r) => r !== rev).slice(-1)[0]);
          }}
        >
          {rev.replace(/-/g, '/')} の改定を消す
        </ConfirmButton>
      )}
    </div>
  );
}

function BackupBox({ onDone }: { onDone: (msg: string) => void }) {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<BackupFile | null>(null);
  return (
    <div>
      <p className="small">機種変更やスマホの故障に備えて、月に1回は保存しておくと安心です。保存したファイルはGoogleドライブやLINEの自分宛てに置いてください。</p>
      <div className="row-wrap">
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            const data = await db.exportAll();
            download(`日報バックアップ_${app.today()}.json`, JSON.stringify(data, null, 1), 'application/json');
            onDone('バックアップを保存しました');
          }}
        >
          バックアップを保存
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          バックアップから戻す
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const v = validateBackup(JSON.parse(await f.text()));
            if (!v.ok) return setError(v.reason);
            setError('');
            setPending(v.value);
          } catch (err) {
            setError('読み込めませんでした：' + String(err));
          }
        }}
      />
      {pending && (
        <div className="banner warn">
          {pending.exportedAt.slice(0, 10)} のバックアップ（記録 {pending.records.length}日分）に置き換えます。
          <div className="row-wrap">
            <ConfirmButton
              className="btn primary"
              onConfirm={async () => {
                await app.replaceAll(pending);
                onDone(`戻しました（記録 ${pending.records.length}日分）`);
                setPending(null);
              }}
            >
              置き換える
            </ConfirmButton>
            <button type="button" className="btn" onClick={() => setPending(null)}>
              やめる
            </button>
          </div>
        </div>
      )}
      <p className="muted-text small">※「戻す」と、今このスマホにある記録はファイルの内容に置き換わります。</p>
      {error && <p className="warn-text">{error}</p>}
    </div>
  );
}
