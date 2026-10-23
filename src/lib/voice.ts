import { applyTemplate, newId } from './defaults';
import type { DailyRecord, Master, Stop } from './types';

// 話した文（音声認識の結果）を1日の記録に反映する。
// 例：「いつもの便、太田垣 青果55、第一柿 青果30 ケース20、東日本 パレット4 高速、距離290キロ、メモ 渋滞で遅着」
//
// 反映のしかたは「上書き修正」：
//  - 言った行き先がすでにあれば、言った荷物の点数だけ置き換える（言わなかった荷物はそのまま）
//  - なければ行き先を追加する
//  - テンプレート名を言ったら、まずテンプレートを呼び出してから修正をかける
// なので「太田垣 青果55」とだけ言えば、その1か所の点数だけ直せる。

export interface VoiceStop {
  /** '' は行き先を言わなかった */
  destinationId: string;
  /** cargoTypeId '' は荷物の種類を言わなかった（反映時に推定） */
  items: { cargoTypeId: string; count: number }[];
  highway?: boolean;
}

export interface VoiceParse {
  templateId: string | null;
  dayOff: boolean;
  stops: VoiceStop[];
  km10: number | null;
  start10: number | null;
  end10: number | null;
  /** 出発・帰着の時刻 'HH:MM' */
  startTime: string | null;
  endTime: string | null;
  memo: string;
  /** 聞き取ったが意味がわからなかった部分（呼び名の登録に使う） */
  unknown: string[];
  warnings: string[];
}

type Kw = 'highway' | 'noHighway' | 'distance' | 'start' | 'end' | 'dayOff';
type Tok =
  | { t: 'dest'; id: string }
  | { t: 'cargo'; id: string }
  | { t: 'tpl'; id: string }
  | { t: 'kw'; k: Kw }
  | { t: 'num'; v10: number; km: boolean }
  | { t: 'time'; hhmm: string }
  | { t: 'unknown'; text: string };

const KEYWORDS: [string, Kw][] = [
  ['高速なし', 'noHighway'],
  ['高速無し', 'noHighway'],
  ['高速使わず', 'noHighway'],
  ['高速は使わない', 'noHighway'],
  ['高速使わない', 'noHighway'],
  ['高速道路', 'highway'],
  ['高速', 'highway'],
  ['こうそく', 'highway'],
  ['走行距離', 'distance'],
  ['距離', 'distance'],
  ['走行', 'distance'],
  ['出発めーたー', 'start'],
  ['出発', 'start'],
  ['すたーと', 'start'],
  ['出庫', 'start'],
  ['帰着めーたー', 'end'],
  ['帰着', 'end'],
  ['到着', 'end'],
  ['帰庫', 'end'],
  ['帰り', 'end'],
  ['運行なし', 'dayOff'],
  ['休み', 'dayOff'],
  ['やすみ', 'dayOff'],
  ['休日', 'dayOff'],
];
const KM_UNITS = ['きろめーとる', 'きろ', 'km'];
const COUNT_UNITS = ['点', 'てん', '枚', 'まい', '個', 'こ', 'けーす', 'ぱれっと', '本', '箱', '台'];
const ORDINAL_UNITS = ['件目', '番目', '箇所目', 'か所目', 'ヶ所目', '軒目', 'けんめ', 'ばんめ'];
const FILLERS = [
  'えーと', 'えっと', 'えー', 'あのー', 'あの', 'それから', 'それと', 'あと', '次は', '次', 'つぎ', 'です', 'でした', 'ます',
  'から', 'まで', '合計', '全部', '行き先', '荷物', 'めーたー', '円', 'は', 'が', 'を', 'の', 'で', 'に', 'も', 'や', 'と', 'ね', 'よ',
];

const KANJI_DIGIT: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 漢数字の並び（二百八十、千二百、一万二千、三〇〇）を数字に */
export function kanjiToNumber(s: string): number {
  if (!/[十百千万]/.test(s)) return Number([...s].map((c) => KANJI_DIGIT[c]).join(''));
  let total = 0;
  let section = 0;
  let digit = -1;
  for (const c of s) {
    if (c in KANJI_DIGIT) digit = KANJI_DIGIT[c];
    else if (c in KANJI_UNIT) {
      section += (digit < 0 ? 1 : digit) * KANJI_UNIT[c];
      digit = -1;
    } else if (c === '万') {
      total += (section + (digit < 0 ? 0 : digit) || 1) * 10000;
      section = 0;
      digit = -1;
    }
  }
  return total + section + (digit < 0 ? 0 : digit);
}

/** 照合用の正規化：全角→半角、カタカナ→ひらがな、漢数字→数字、小文字、区切り記号→空白 */
export function normalize(s: string): string {
  return s
    .replace(/[（(][^）)]*[）)]/g, ' ') // 「（仮）」などの注記は無視
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[〇零一二三四五六七八九十百千万]+/g, (m) => String(kanjiToNumber(m)))
    .toLowerCase()
    .replace(/(\d),(?=\d{3})/g, '$1')
    .replace(/(\d+)(?:点|てん)(\d+)\s*(きろ|km)/g, '$1.$2$3') // 「280点5キロ」= 280.5km
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[、。,!?・「」『』\s]+/g, ' ')
    .trim();
}

interface Entry {
  key: string;
  tok: Tok;
}

function dictionary(master: Master): Entry[] {
  const out: Entry[] = [];
  const add = (raw: string, tok: Tok) => {
    const key = normalize(raw).replace(/\s+/g, '');
    if (key.length > 0) out.push({ key, tok });
  };
  for (const d of master.destinations.filter((x) => x.active)) {
    add(d.name, { t: 'dest', id: d.id });
    for (const a of d.aliases ?? []) add(a, { t: 'dest', id: d.id });
  }
  for (const c of master.cargoTypes.filter((x) => x.active)) {
    add(c.name, { t: 'cargo', id: c.id });
    for (const a of c.aliases ?? []) add(a, { t: 'cargo', id: c.id });
  }
  for (const t of master.templates) add(t.name, { t: 'tpl', id: t.id });
  for (const [k, kw] of KEYWORDS) add(k, { t: 'kw', k: kw });
  // 長い言葉から先に当てる（「高速なし」を「高速」より先に）
  return out.sort((a, b) => b.key.length - a.key.length);
}

function tokenize(text: string, master: Master): Tok[] {
  const s = normalize(text);
  const dict = dictionary(master);
  const units = [...new Set([...COUNT_UNITS, ...master.cargoTypes.map((c) => normalize(c.unit))])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const toks: Tok[] = [];
  let unknown = '';
  const flushUnknown = () => {
    if (unknown.trim()) toks.push({ t: 'unknown', text: unknown.trim() });
    unknown = '';
  };
  const dictAt = (i: number) => dict.find((e) => s.startsWith(e.key, i));
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ') {
      unknown += ' ';
      i++;
      continue;
    }
    const hit = dictAt(i);
    if (hit) {
      flushUnknown();
      toks.push(hit.tok);
      i += hit.key.length;
      continue;
    }
    // 時刻：「21時30分」「5時半」「21:30」（「10時間」は時刻ではない）
    const tm = /^(\d{1,2})(?:時(?!間)(?:(\d{1,2})分|(半))?|:(\d{2}))/.exec(s.slice(i));
    if (tm && Number(tm[1]) < 24) {
      flushUnknown();
      const mm = tm[3] ? 30 : Number(tm[2] ?? tm[4] ?? 0);
      toks.push({ t: 'time', hhmm: `${tm[1].padStart(2, '0')}:${String(mm).padStart(2, '0')}` });
      i += tm[0].length;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (num) {
      flushUnknown();
      const [int, frac = ''] = num[0].split('.');
      const v10 = Number(int) * 10 + Number((frac + '0')[0]);
      i += num[0].length;
      while (s[i] === ' ') i++;
      if (dictAt(i)) {
        toks.push({ t: 'num', v10, km: false });
        continue;
      }
      const ord = ORDINAL_UNITS.find((u) => s.startsWith(u, i));
      if (ord) {
        i += ord.length; // 「2件目」の2は点数ではない
        continue;
      }
      const kmu = KM_UNITS.find((u) => s.startsWith(u, i));
      if (kmu) {
        toks.push({ t: 'num', v10, km: true });
        i += kmu.length;
        continue;
      }
      const cu = units.find((u) => s.startsWith(u, i));
      if (cu) i += cu.length;
      toks.push({ t: 'num', v10, km: false });
      continue;
    }
    unknown += s[i];
    i++;
  }
  flushUnknown();
  return toks;
}

export function parseVoice(text: string, master: Master): VoiceParse {
  // 「メモ」から後ろは、そのままメモにする（言い回しを崩さないため正規化前の文から切り出す）
  const memoAt = text.search(/メモ|めも/);
  const memo = memoAt >= 0 ? text.slice(memoAt + 2).replace(/^[\s、。,:：はを]+/, '').trim() : '';
  const body = memoAt >= 0 ? text.slice(0, memoAt) : text;

  // 助詞・つなぎ言葉だけの断片は先に取り除く（「パレットを4枚」の「を」で荷物と数が離れないように）
  const out: VoiceParse = {
    templateId: null,
    dayOff: false,
    stops: [],
    km10: null,
    start10: null,
    end10: null,
    startTime: null,
    endTime: null,
    memo,
    unknown: [],
    warnings: [],
  };
  const toks = tokenize(body, master).filter((tk) => {
    if (tk.t !== 'unknown') return true;
    let rest = tk.text.replace(/\s+/g, '');
    for (const f of FILLERS) rest = rest.split(f).join('');
    if (rest.length >= 2) {
      // 前後の助詞は落とす（「大田垣で」→「大田垣」）。これを呼び名に登録するため
      const word = tk.text
        .replace(/\s+/g, '')
        .replace(/^(?:えーと|えっと|えー|あの|それから|それと|あと|次は|次)+/, '')
        .replace(/(?:です|でした|は|が|を|の|で|に|も|や|と|ね|よ)+$/, '');
      if (word.length >= 2) out.unknown.push(word);
    }
    return false;
  });
  let cur: VoiceStop | null = null;
  let pending: number | null = null;
  const cargoName = (id: string) => master.cargoTypes.find((c) => c.id === id)?.name ?? id;

  const ensureStop = () => {
    if (!cur) {
      cur = { destinationId: '', items: [] };
      out.stops.push(cur);
    }
    return cur;
  };
  const setItem = (cargoTypeId: string, v10: number) => {
    const stop = ensureStop();
    if (v10 % 10 !== 0) out.warnings.push(`点数に小数があります（${v10 / 10}）。切り捨てました`);
    const count = Math.floor(v10 / 10);
    const ex = stop.items.find((x) => x.cargoTypeId === cargoTypeId);
    if (ex) ex.count = count;
    else stop.items.push({ cargoTypeId, count });
  };
  const flushPending = () => {
    if (pending !== null) setItem('', pending);
    pending = null;
  };

  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    const next = toks[i + 1];
    const prev = toks[i - 1];
    switch (tk.t) {
      case 'dest':
        flushPending();
        cur = { destinationId: tk.id, items: [] };
        out.stops.push(cur);
        break;
      case 'cargo':
        if (next?.t === 'num' && !next.km) {
          setItem(tk.id, next.v10);
          i++;
        } else if (pending !== null) {
          setItem(tk.id, pending);
          pending = null;
        } else {
          out.warnings.push(`「${cargoName(tk.id)}」の数が聞き取れませんでした`);
        }
        break;
      case 'time':
        // 「21時出発」のように時刻が先
        if (next?.t === 'kw' && (next.k === 'start' || next.k === 'end')) {
          if (next.k === 'start') out.startTime = tk.hhmm;
          else out.endTime = tk.hhmm;
          i++;
        } else {
          out.warnings.push(`時刻 ${tk.hhmm} が出発か帰着かわかりませんでした`);
        }
        break;
      case 'tpl':
        out.templateId = tk.id;
        break;
      case 'kw':
        if (tk.k === 'dayOff') out.dayOff = true;
        else if (tk.k === 'highway' || tk.k === 'noHighway') {
          if (cur || out.stops.length) (cur ?? out.stops[out.stops.length - 1]).highway = tk.k === 'highway';
          else out.warnings.push('どの行き先で高速を使ったか聞き取れませんでした');
        } else if (next?.t === 'time' && (tk.k === 'start' || tk.k === 'end')) {
          if (tk.k === 'start') out.startTime = next.hhmm;
          else out.endTime = next.hhmm;
          i++;
        } else if (next?.t === 'num') {
          if (tk.k === 'distance') out.km10 = next.v10;
          else if (tk.k === 'start') out.start10 = next.v10;
          else out.end10 = next.v10;
          i++;
        }
        break;
      case 'num':
        if (tk.km) {
          if (prev?.t === 'kw' && (prev.k === 'start' || prev.k === 'end')) break;
          out.km10 = tk.v10;
        } else {
          flushPending();
          pending = tk.v10;
        }
        break;
    }
  }
  flushPending();
  return out;
}

export interface VoiceApply {
  record: DailyRecord;
  /** 何を反映したかの説明（画面に出す） */
  changes: string[];
  warnings: string[];
}

export function applyVoice(record: DailyRecord, p: VoiceParse, master: Master): VoiceApply {
  const changes: string[] = [];
  const warnings = [...p.warnings];
  const dn = (id: string) => master.destinations.find((d) => d.id === id)?.name ?? '（行き先未選択）';
  const cn = (id: string) => master.cargoTypes.find((c) => c.id === id)?.name ?? '';
  const firstCargo = master.cargoTypes.filter((c) => c.active).sort((a, b) => a.order - b.order)[0]?.id ?? '';

  let r: DailyRecord = { ...record, stops: record.stops.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) })) };
  if (p.dayOff) {
    changes.push('休み・運行なし');
    r = { ...r, dayOff: true };
  }
  const tpl = p.templateId ? master.templates.find((t) => t.id === p.templateId) : undefined;
  if (tpl) {
    r = applyTemplate(r, tpl);
    changes.push(`「${tpl.name}」を呼び出し`);
  }

  const used = new Set<number>();
  for (const vs of p.stops) {
    let idx = -1;
    if (vs.destinationId) {
      idx = r.stops.findIndex((s, j) => !used.has(j) && s.destinationId === vs.destinationId);
    } else {
      // 行き先を言わなかった：その荷物を持つ行き先が1つだけならそこを直す
      const named = vs.items.filter((x) => x.cargoTypeId);
      const cands = r.stops.map((_, j) => j).filter((j) => named.length > 0 && named.every((x) => r.stops[j].items.some((y) => y.cargoTypeId === x.cargoTypeId)));
      if (cands.length === 1) idx = cands[0];
      else if (r.stops.length === 1) idx = 0;
    }
    let stop: Stop;
    if (idx >= 0) {
      stop = r.stops[idx];
      used.add(idx);
    } else {
      stop = { id: newId('s'), destinationId: vs.destinationId, items: [], highway: false };
      r.stops.push(stop);
      used.add(r.stops.length - 1);
      if (!vs.destinationId) warnings.push('行き先が聞き取れなかったので、行き先を選んでください');
    }
    const parts: string[] = [];
    for (const it of vs.items) {
      let cargoTypeId = it.cargoTypeId;
      if (!cargoTypeId) {
        cargoTypeId = stop.items.length === 1 ? stop.items[0].cargoTypeId : firstCargo;
        if (stop.items.length !== 1) warnings.push(`荷物の種類が聞き取れなかったので「${cn(cargoTypeId)}」にしました`);
      }
      const ex = stop.items.find((x) => x.cargoTypeId === cargoTypeId);
      if (ex) ex.count = it.count;
      else stop.items.push({ cargoTypeId, count: it.count });
      parts.push(`${cn(cargoTypeId)}${it.count}`);
    }
    stop.items = stop.items.filter((x) => x.count > 0);
    if (vs.highway !== undefined) {
      stop.highway = vs.highway;
      parts.push(vs.highway ? '高速あり' : '高速なし');
    }
    changes.push(`${dn(stop.destinationId)}${parts.length ? '：' + parts.join('・') : ''}`);
  }

  if (p.km10 !== null) {
    r = { ...r, distance: { mode: 'direct', km10: p.km10 } };
    changes.push(`距離 ${p.km10 / 10}km`);
  } else if (p.start10 !== null || p.end10 !== null) {
    const prev = r.distance.mode === 'meter' ? r.distance : { start10: null, end10: null };
    r = { ...r, distance: { mode: 'meter', start10: p.start10 ?? prev.start10, end10: p.end10 ?? prev.end10 } };
    changes.push(`メーター ${p.start10 !== null ? '出発' + p.start10 / 10 : ''}${p.end10 !== null ? ' 帰着' + p.end10 / 10 : ''}`.trim());
  }
  if (p.startTime || p.endTime) {
    r = { ...r, startTime: p.startTime ?? r.startTime, endTime: p.endTime ?? r.endTime };
    changes.push(`時刻 ${p.startTime ? '出発' + p.startTime : ''}${p.endTime ? ' 帰着' + p.endTime : ''}`.trim());
  }
  if (p.memo) {
    r = { ...r, memo: r.memo ? `${r.memo} / ${p.memo}` : p.memo };
    changes.push(`メモ「${p.memo}」`);
  }
  if (!p.dayOff && (p.stops.length > 0 || tpl || p.km10 !== null)) r = { ...r, dayOff: false };
  return { record: r, changes, warnings };
}
