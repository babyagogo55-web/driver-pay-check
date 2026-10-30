import { useState, type ReactNode } from 'react';
import { FixedInput, IntInput } from '../components/ui';
import { resolveDated } from '../lib/calc';
import { FIRST_DAY, missingSetup, newId, sampleMaster } from '../lib/defaults';
import type { Dated, Master } from '../lib/types';
import { useApp } from '../store';
import { ListEditor, MapsOptionalNote, PriceTable } from './SettingsScreen';

// はじめの設定。基本給・単価などの金額は、本人が自分の給与明細や会社の資料を見て入れる。
// どの画面も「あとで」で飛ばせる（設定画面からいつでも直せる）。

const STEPS = ['ようこそ', 'あなたの情報', '給料の決まり', '行き先と荷物', '単価表', '締め日', 'Googleマップ（任意）'];

export function SetupScreen() {
  const app = useApp();
  const { master } = app;
  const [step, setStep] = useState(0);
  const up = (patch: Partial<Master>) => app.updateMaster((m) => ({ ...m, ...patch }));
  const finish = () => {
    up({ setupDone: true });
    app.setTab('record');
  };
  const next = () => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo(0, 0);
  };
  const back = () => {
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo(0, 0);
  };
  const missing = missingSetup(master);

  if (step === 0) {
    return (
      <div className="screen setup">
        <section className="card">
          <h2>運行日報・給与チェックへようこそ</h2>
          <p>毎日の運行を記録して、給料の概算を出し、会社の明細と照らし合わせるアプリです。</p>
          <p>
            はじめに、<b>基本給や単価など、あなたの給料の決まり</b>を入れます。給与明細や会社の資料を手元に用意してください（5〜10分ほど）。
          </p>
          <p className="muted-text small">入れた内容と記録は、このスマホの中だけに保存されます。会社や外部には送られません。</p>
        </section>
        <button type="button" className="btn big primary block" onClick={next}>
          自分の値を入れて始める
        </button>
        <button
          type="button"
          className="btn block"
          onClick={() => {
            app.updateMaster((m) => ({ ...sampleMaster(), maps: { ...sampleMaster().maps, apiKey: m.maps.apiKey }, isSample: true, setupDone: true }));
            app.setTab('record');
          }}
        >
          まず見本の値で試してみる
        </button>
        <p className="muted-text small">見本の金額は本物ではありません。試したあと「設定」から消して、自分の値で始められます。</p>
      </div>
    );
  }

  return (
    <div className="screen setup">
      <div className="setup-head">
        <span className="muted-text small">
          はじめの設定 {step}/{STEPS.length - 1}
        </span>
        <h2>{STEPS[step]}</h2>
        <div className="setup-bar" aria-hidden>
          <span style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
        </div>
      </div>

      {step === 1 && (
        <Card>
          <p className="small">レポートに載せる名前です。空欄のままでも使えます。</p>
          <label className="field">
            <span>氏名</span>
            <input className="text-input" value={master.driverName} autoComplete="name" onChange={(e) => up({ driverName: e.target.value })} />
          </label>
          <label className="field">
            <span>営業所</span>
            <input className="text-input" value={master.office} onChange={(e) => up({ office: e.target.value })} />
          </label>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <p className="small">給与明細や雇用契約書を見て入れてください。昇給したときは、あとで「設定」から「この日から変更」で足せます。</p>
          <label className="field">
            <span>基本給（月額）</span>
            <span className="field-row">
              <IntInput
                value={latest(master.baseSalary)}
                ariaLabel="基本給（月額）"
                placeholder="例：200000"
                className="num-input wide"
                onChange={(v) => up({ baseSalary: setLatest(master.baseSalary, v) })}
              />
              <span className="unit">円</span>
            </span>
          </label>
          <label className="field">
            <span>距離手当（1kmあたり）</span>
            <span className="field-row">
              <FixedInput
                value={latest(master.distanceRateX100)}
                digits={2}
                ariaLabel="距離手当 1kmあたりの円"
                placeholder="例：5"
                onChange={(v) => up({ distanceRateX100: setLatest(master.distanceRateX100, v) })}
              />
              <span className="unit">円 / 1km</span>
            </span>
          </label>
          <p className="muted-text small">距離手当がない場合は 0 を入れてください。1円未満（例：4.5円）も入れられます。</p>
        </Card>
      )}

      {step === 3 && (
        <>
          <Card>
            <h3>行き先（市場・荷主など）</h3>
            <p className="small">よく行く所を「＋ 追加」で入れ、名前を書き換えます。音声入力で呼ぶときの読み方も入れられます。</p>
            <ListEditor
              items={master.destinations}
              onChange={(destinations) => up({ destinations })}
              make={(order) => ({ id: newId('d'), name: '', order, active: true })}
            />
          </Card>
          <Card>
            <h3>荷物の種類</h3>
            <p className="small">手当の単価が分かれている荷物の種類ごとに入れます（例：青果・ケース・パレット）。右の欄は数え方です。</p>
            <ListEditor
              items={master.cargoTypes}
              onChange={(cargoTypes) => up({ cargoTypes })}
              make={(order) => ({ id: newId('c'), name: '', unit: '点', order, active: true })}
              extra={(c, set) => (
                <input className="text-input unit-input" aria-label="単位" value={c.unit} onChange={(e) => set({ ...c, unit: e.target.value })} />
              )}
            />
          </Card>
        </>
      )}

      {step === 4 && (
        <Card>
          {master.destinations.some((d) => d.active) && master.cargoTypes.some((c) => c.active) ? (
            <>
              <p className="small">行き先ごと・荷物ごとの「1点あたりの手当」を入れます。分からない所は空欄で進んで、あとで入れても大丈夫です。</p>
              <PriceTable />
            </>
          ) : (
            <p className="warn-text">先に「行き先と荷物」を1つ以上入れてください。</p>
          )}
        </Card>
      )}

      {step === 5 && (
        <Card>
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
          <p className="muted-text small">高速道路の加算・端数の扱い・夜中の運行の日付などは、「設定」でいつでも変えられます。</p>
        </Card>
      )}

      {step === 6 && (
        <Card>
          <MapsOptionalNote />
          <p className="small">使う場合は、あとで「設定 → Googleマップ連携（任意）」で営業所と行き先の住所を入れてください。今は何もしなくて大丈夫です。</p>
          {missing.length > 0 ? (
            <p className="warn-text">まだ入っていない設定：{missing.join('・')}（あとで「設定」から入れられます。入れるまでその分は0円で計算します）</p>
          ) : (
            <p className="ok-text">✓ 給料の計算に必要な設定がそろいました。</p>
          )}
        </Card>
      )}

      <div className="setup-nav">
        <button type="button" className="btn" onClick={back}>
          ◀ 戻る
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn primary" onClick={next}>
            次へ ▶
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={finish}>
            設定を終えて記録を始める
          </button>
        )}
      </div>
      {step < STEPS.length - 1 && (
        <button type="button" className="btn small block muted" onClick={finish}>
          残りはあとで設定する
        </button>
      )}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>;
}

function latest(history: Dated<number>[]): number | null {
  return resolveDated(history, '9999-12-31');
}

/** いちばん新しい値を書き換える（まだ無ければ「最初から」の値として作る。履歴が1つだけなら空欄で消す） */
function setLatest(history: Dated<number>[], v: number | null): Dated<number>[] {
  if (history.length === 0) return v === null ? [] : [{ from: FIRST_DAY, value: v }];
  const last = [...history].sort((a, b) => (a.from < b.from ? -1 : 1)).slice(-1)[0];
  if (v === null) return history.length === 1 ? [] : history;
  return history.map((h) => (h.from === last.from ? { ...h, value: v } : h));
}
