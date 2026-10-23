// データモデル。金額はすべて「円の整数」。距離は「0.1km単位の整数」、距離単価は「1/100円単位の整数」で持ち、
// 浮動小数点を計算に一切使わない。

/** 'YYYY-MM-DD' 形式の日付文字列 */
export type DateStr = string;
/** 'YYYY-MM' 形式。締め日で区切った「支給対象月」の名前（締め日が属する月） */
export type PeriodStr = string;

export type RoundingMode = 'floor' | 'round' | 'ceil';

/** 適用開始日つきの値（値上げ履歴） */
export interface Dated<T> {
  from: DateStr;
  value: T;
}

export interface Destination {
  id: string;
  name: string;
  /** 音声入力で聞き取られやすい別の書き方（読み仮名・誤変換）。例：['おおたがき', '大田垣'] */
  aliases?: string[];
  /** Googleマップで探せる住所・施設名（例：山形市中央卸売市場） */
  address?: string;
  order: number;
  active: boolean;
}

export interface CargoType {
  id: string;
  name: string;
  /** 数え方の単位（点・ケース・パレット等） */
  unit: string;
  aliases?: string[];
  order: number;
  active: boolean;
}

/** 高速道路を使った行き先1件あたりの加算を、単価表の特別な列として扱うための荷物種別ID */
export const HIGHWAY_CARGO_ID = '__highway__';

/** 行き先 × 荷物種別 の単価（1点あたり円）。適用開始日ごとに1行 */
export interface UnitPrice {
  destinationId: string;
  cargoTypeId: string;
  from: DateStr;
  price: number;
}

export interface CargoItem {
  cargoTypeId: string;
  count: number;
}

export interface Stop {
  id: string;
  destinationId: string;
  items: CargoItem[];
  highway: boolean;
}

export type DistanceInput =
  | { mode: 'direct'; km10: number | null }
  | { mode: 'meter'; start10: number | null; end10: number | null };

/** Googleマップで出したルートの目安（証拠として記録に残す） */
export interface MapRoute {
  /** どの道順で出したか（行き先・高速の組み合わせ）。変わったら出し直す */
  key: string;
  km10: number;
  seconds: number;
  at: string;
}

export interface DailyRecord {
  date: DateStr;
  /** 出発・帰着の時刻 'HH:MM'（任意。拘束時間の記録用） */
  startTime?: string;
  endTime?: string;
  mapRoute?: MapRoute;
  /** 休み・運行なしの日（カレンダーで「記録済み」扱いにする） */
  dayOff: boolean;
  stops: Stop[];
  distance: DistanceInput;
  memo: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  stops: Omit<Stop, 'id'>[];
  /** いつもの走行距離（0.1km単位）。空なら距離は呼び出さない */
  km10: number | null;
}

export type CompanyDailyBasis = 'operation' | 'operationPlusDistance';

export interface Master {
  schemaVersion: 1;
  driverName: string;
  office: string;
  baseSalary: Dated<number>[];
  /** 1kmあたりの距離手当（1/100円単位。5円/km → 500） */
  distanceRateX100: Dated<number>[];
  destinations: Destination[];
  cargoTypes: CargoType[];
  unitPrices: UnitPrice[];
  /** 単価表の改定日一覧（空の改定日も画面に出すため明示的に持つ） */
  priceRevisions: DateStr[];
  /** 高速利用時の加算。'none'=加算なし、'perStop'=行き先ごとに単価表の「高速」列の金額を加算 */
  highwayMode: 'none' | 'perStop';
  /** 高速加算を運行内容手当に含めて会社明細と比べるか */
  highwayInOperation: boolean;
  /** 締め日。0=月末締め、1〜28=その日締め */
  closingDay: number;
  /** 支給日（表示用のみ）。0=未設定 */
  payDay: number;
  rounding: RoundingMode;
  /** 距離手当の端数を日ごとに処理するか、月合計で処理するか */
  roundingTiming: 'daily' | 'monthly';
  /** 会社明細の「日別の金額」が何を表すか（不明のため設定で切替） */
  companyDailyBasis: CompanyDailyBasis;
  /** この時刻より前に開いたら「前日」の記録を出す（夜間運行向け）。0=切替なし */
  dayStartHour: number;
  templates: Template[];
  reminderTime: string;
  maps: MapsSettings;
  /** 仮のサンプル値のままかどうか（画面に注意を出す） */
  isSample: boolean;
}

export interface MapsSettings {
  /** 出発・帰着する営業所の住所 */
  officeAddress: string;
  /** 最後に営業所へ戻るまでを距離に入れる */
  roundTrip: boolean;
  /** Routes API のキー。この端末にだけ保存（バックアップには入れない） */
  apiKey: string;
  /** 距離が空のとき、地図の距離を自動で入れる */
  autoFill: boolean;
  /** 入力した距離と地図の目安がこの割合以上違えば警告（%） */
  tolerancePct: number;
  /** 出したルートの使い回し（同じ道順なら再取得しない＝無料枠の節約） */
  cache: Record<string, { km10: number; seconds: number; at: string }>;
}

export type ReconcileStatus =
  | 'unchecked'
  | 'match'
  | 'inquiring'
  | 'nextMonth'
  | 'resolved'
  | 'myMistake';

export interface DayCheck {
  status: ReconcileStatus;
  note: string;
}

/** 会社から届いた明細の写し（月ごと） */
export interface Statement {
  period: PeriodStr;
  baseSalary: number | null;
  distanceAllowance: number | null;
  operationAllowance: number | null;
  totalGross: number | null;
  /** 日別の会社記載額（記載があれば） */
  daily: Record<DateStr, number>;
  dayChecks: Record<DateStr, DayCheck>;
  status: ReconcileStatus;
  note: string;
  /** 控除の概算（任意） */
  deductions: { name: string; amount: number }[];
  updatedAt: string;
}

export interface BackupFile {
  app: 'driver-pay-check';
  schemaVersion: 1;
  exportedAt: string;
  master: Master;
  records: DailyRecord[];
  statements: Statement[];
}
