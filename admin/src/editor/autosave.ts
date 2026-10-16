/**
 * 自動存檔排程。純邏輯，時間與計時器都由外面注入（測試用假時鐘，不用真的等）。
 *
 * 規則（沿用 wildrunner 的節奏，數字之後依量測調整）：
 *  · 閒置 idleMs 才存；兩次存檔至少相隔 minGapMs
 *  · 被擋住（上傳進行中、中文輸入法組字中）時不存
 *  · 同一時間只有一個存檔在飛；存檔期間又有變更 → 結束後再補一次
 *  · 失敗不吞掉：保持 dirty、指數退避重試，狀態顯示 error
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface AutosaveDeps {
  idleMs?: number;
  minGapMs?: number;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  save: () => Promise<void>;
  /** 回傳 true 代表現在不能存（上傳中、組字中） */
  blocked?: () => boolean;
  onState?: (s: SaveState) => void;
}

export function createAutosave(deps: AutosaveDeps) {
  const idle = deps.idleMs ?? 3000, gap = deps.minGapMs ?? 30_000;
  let state: SaveState = 'saved';
  let timer: unknown = null;
  let lastSaveAt = -Infinity;
  let dirtyDuringSave = false;
  let failures = 0;
  let lastEditAt = -Infinity;
  let inflight: Promise<void> | null = null;

  const set = (s: SaveState) => { if (s !== state) { state = s; deps.onState?.(s); } };
  const clear = () => { if (timer !== null) { deps.clearTimer(timer); timer = null; } };

  function schedule(delay: number) {
    clear();
    timer = deps.setTimer(() => { timer = null; void run(); }, Math.max(0, delay));
  }

  async function run() {
    if (state === 'saving') { dirtyDuringSave = true; return; }
    if (state === 'saved') return;
    if (deps.blocked?.()) { schedule(1000); return; }
    set('saving');
    dirtyDuringSave = false;
    let release!: () => void;
    inflight = new Promise<void>((r) => { release = r; });
    try {
      await deps.save();
      failures = 0;
      lastSaveAt = deps.now();
      if (dirtyDuringSave) { set('dirty'); schedule(Math.max(idle, lastSaveAt + gap - deps.now())); }
      else set('saved');
    } catch {
      failures++;
      set('error');
      schedule(Math.min(60_000, 2000 * 2 ** (failures - 1)));
      // 重試時要能真的存：error 也視為待存
      state = 'error';
    } finally {
      inflight = null;
      release();
    }
  }

  return {
    get state() { return state; },
    /** 內容有變 */
    markDirty() {
      lastEditAt = deps.now();
      if (state === 'saving') { dirtyDuringSave = true; return; }
      if (state === 'saved') set('dirty');
      schedule(Math.max(idle, lastSaveAt + gap - deps.now()));
    },
    /**
     * 立刻存（離開頁面、按發佈前）。被擋住時回傳 false，呼叫端不能繼續。
     * 剛好有一個存檔在飛：等它結束，再把那之後的變更也存掉——不是直接回 false。
     */
    async flush(): Promise<boolean> {
      clear();
      if (inflight) await inflight;
      clear();
      if (state === 'saved') return true;
      if (deps.blocked?.()) return false;
      if (state === 'error') set('dirty');
      await run();
      return (state as SaveState) === 'saved';
    },
    cancel: clear,
    get lastEditAt() { return lastEditAt; },
  };
}
