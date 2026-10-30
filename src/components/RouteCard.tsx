import { useEffect, useRef, useState } from 'react';
import { fetchRoute } from '../maps';
import { formatDuration, formatMinutes, planRoute, workMinutes } from '../lib/route';
import type { DailyRecord } from '../lib/types';
import { useApp } from '../store';

// 地図の目安（距離・運転時間）と、出発・帰着の時刻。
// 同じ道順は端末内の控えを使うので、いつものルートなら通信もしない。

export function RouteCard({ record, put }: { record: DailyRecord; put: (r: DailyRecord) => void }) {
  const app = useApp();
  const { maps } = app.master;
  const plan = planRoute(record, app.master);
  const planKey = 'key' in plan ? plan.key : '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(record);
  latest.current = record;

  const current = record.mapRoute && record.mapRoute.key === planKey ? record.mapRoute : null;

  useEffect(() => {
    setError('');
    if (!planKey || !('key' in plan) || current) return;
    const apply = (route: { key: string; km10: number; seconds: number; at: string }) => {
      const r = latest.current;
      const emptyDistance = r.distance.mode === 'direct' ? r.distance.km10 === null : r.distance.start10 === null && r.distance.end10 === null;
      put({
        ...r,
        mapRoute: route,
        ...(maps.autoFill && emptyDistance ? { distance: { mode: 'direct' as const, km10: route.km10 } } : {}),
      });
    };
    const cached = maps.cache[planKey];
    if (cached) {
      apply({ key: planKey, ...cached });
      return;
    }
    if (!maps.apiKey) return;
    // 行き先を選んでいる途中で何度も問い合わせないよう、少し待つ
    const t = setTimeout(async () => {
      setBusy(true);
      const res = await fetchRoute(maps.apiKey, plan);
      setBusy(false);
      if ('error' in res) return setError(res.error);
      app.updateMaster((m) => ({
        ...m,
        maps: { ...m.maps, cache: { ...m.maps.cache, [res.key]: { km10: res.km10, seconds: res.seconds, at: res.at } } },
      }));
      apply(res);
    }, 1500);
    return () => clearTimeout(t);
    // plan は毎回作り直されるので、道順のキーが変わったときだけ動かす
  }, [planKey, maps.apiKey, !!current]);

  const work = workMinutes(record.startTime, record.endTime);
  const setupHint = !maps.officeAddress && !maps.apiKey;

  return (
    <section className="card">
      <h2>ルート・時間</h2>
      {'error' in plan ? (
        <p className="muted-text small">
          {setupHint ? '（任意）「設定 → Googleマップ連携」で住所を入れると、地図で距離と時間の目安が出ます。使わなくても記録と計算はできます。' : plan.error}
        </p>
      ) : (
        <>
          {current ? (
            <div className="map-result">
              <div>
                地図の目安 <b>{current.km10 / 10}km</b>・運転 約<b>{formatDuration(current.seconds)}</b>
              </div>
              {!(record.distance.mode === 'direct' && record.distance.km10 === current.km10) && (
                <button type="button" className="btn small" onClick={() => put({ ...record, distance: { mode: 'direct', km10: current.km10 } })}>
                  この距離を入れる
                </button>
              )}
            </div>
          ) : busy ? (
            <p className="muted-text">地図で計算中…</p>
          ) : maps.apiKey ? (
            error && <p className="warn-text small">{error}</p>
          ) : (
            <p className="muted-text small">APIキーを設定すると、ここに距離と時間が自動で出ます。</p>
          )}
          <a className="btn small block map-link" href={plan.link} target="_blank" rel="noopener noreferrer">
            🗺 Googleマップでルートを見る
          </a>
          <p className="muted-text tiny">距離手当はメーターの距離が正です。地図の距離は目安と打ち間違いの確認に使います。</p>
        </>
      )}
      <div className="time-row">
        <label>
          <span className="mini">出発</span>
          <input type="time" className="text-input" value={record.startTime ?? ''} onChange={(e) => put({ ...record, startTime: e.target.value || undefined })} />
        </label>
        <label>
          <span className="mini">帰着</span>
          <input type="time" className="text-input" value={record.endTime ?? ''} onChange={(e) => put({ ...record, endTime: e.target.value || undefined })} />
        </label>
      </div>
      {work !== null && <p className="muted-text">拘束時間 {formatMinutes(work)}</p>}
    </section>
  );
}
