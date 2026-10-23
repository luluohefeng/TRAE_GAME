import './styles.css';
import './game/tests.ts';
import { IDENTITY, det, multiply, type Mat2 } from './game/matrix.ts';
import {
  applyCard,
  applyCustomCard,
  createGame,
  reset,
  undo,
  type GameState,
  type Level,
} from './game/state.ts';
import { evaluate } from './game/judge.ts';
import { loadLevel, type LevelJson } from './game/cards.ts';
import { animateMatrix } from './game/animation.ts';
import { createView, drawScene } from './render/canvas.ts';
import { renderHand, type HandUI } from './render/cards.ts';
import { renderLatex, toMatrixLatex } from './render/latex.ts';
import { DIFFICULTY_RULES, generateRandomLevel, type Difficulty } from './game/generator.ts';
import { getHint } from './ai/client.ts';
import { runDemo } from './demo.ts';
import level1Json from './levels/level1.json';
import level2Json from './levels/level2.json';
import level3Json from './levels/level3.json';
import workshopJson from './levels/workshop.json';

const levels: Level[] = [
  loadLevel(level1Json as LevelJson),
  loadLevel(level2Json as LevelJson),
  loadLevel(level3Json as LevelJson),
  loadLevel(workshopJson as LevelJson),
];
const MAIN_LEVELS = 3;
const WORKSHOP_INDEX = 3;

const ANIMATION_MS = 300;
const FORMULA_DEBOUNCE_MS = 100;
const INPUT_DEBOUNCE_MS = 100;
const CUSTOM_COST = 2;
const FAIL_TEXT: Record<string, string> = {
  forbidden: '钥匙落入禁区',
  steps: '步数超限',
  projection: '投影后压线，',
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app root element not found');
}

const title = document.createElement('h1');
title.textContent = '矩阵折叠密室';
app.appendChild(title);

const levelLine = document.createElement('div');
levelLine.id = 'level-line';
app.appendChild(levelLine);

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
canvas.width = 800;
canvas.height = 600;
app.appendChild(canvas);

const stackLine = document.createElement('div');
stackLine.id = 'stack-line';
const stackLabel = document.createElement('span');
stackLabel.textContent = '操作栈（最近 5 步）：';
const stackFormula = document.createElement('span');
stackFormula.id = 'stack-formula';
stackLine.appendChild(stackLabel);
stackLine.appendChild(stackFormula);
app.appendChild(stackLine);

const controls = document.createElement('div');
controls.className = 'controls';
const handEl = document.createElement('div');
handEl.className = 'hand';
const undoBtn = document.createElement('button');
undoBtn.className = 'undo-btn';
undoBtn.textContent = '撤销';
const resetBtn = document.createElement('button');
resetBtn.className = 'reset-btn';
resetBtn.textContent = '重置';
const prevBtn = document.createElement('button');
prevBtn.className = 'nav-btn';
prevBtn.textContent = '上一关';
const nextBtn = document.createElement('button');
nextBtn.className = 'nav-btn';
nextBtn.textContent = '下一关';
const workshopBtn = document.createElement('button');
workshopBtn.className = 'nav-btn workshop-btn';
workshopBtn.textContent = '矩阵工坊';
const hintBtn = document.createElement('button');
hintBtn.className = 'nav-btn ai-btn';
hintBtn.textContent = 'AI 提示';
const difficultySelect = document.createElement('select');
difficultySelect.className = 'difficulty-select';
difficultySelect.setAttribute('aria-label', '随机关卡难度');
const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
for (const d of DIFFICULTY_ORDER) {
  const opt = document.createElement('option');
  opt.value = d;
  opt.textContent = DIFFICULTY_RULES[d].label;
  if (d === 'normal') opt.selected = true;
  difficultySelect.appendChild(opt);
}
const randomLevelBtn = document.createElement('button');
randomLevelBtn.className = 'nav-btn gen-btn';
randomLevelBtn.textContent = '随机关卡';
const demoBtn = document.createElement('button');
demoBtn.className = 'nav-btn demo-btn';
demoBtn.textContent = '演示模式';
controls.appendChild(handEl);
controls.appendChild(undoBtn);
controls.appendChild(resetBtn);
controls.appendChild(prevBtn);
controls.appendChild(nextBtn);
controls.appendChild(workshopBtn);
controls.appendChild(hintBtn);
controls.appendChild(difficultySelect);
controls.appendChild(randomLevelBtn);
controls.appendChild(demoBtn);
app.appendChild(controls);

// ---------- 矩阵工坊面板 ----------
const workshopPanel = document.createElement('div');
workshopPanel.id = 'workshop-panel';

const panelTitle = document.createElement('div');
panelTitle.className = 'workshop-title';
panelTitle.textContent = `矩阵工坊 · 自定义 2×2 矩阵（元素 [-2, 2]，打出消耗 ${CUSTOM_COST} 步，不保证关卡可解）`;
workshopPanel.appendChild(panelTitle);

const inputsGrid = document.createElement('div');
inputsGrid.className = 'matrix-inputs';
const inputs: HTMLInputElement[] = [];
const DEFAULT_VALUES = ['1', '0', '0', '1'];
for (let i = 0; i < 4; i++) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.inputMode = 'decimal';
  inp.value = DEFAULT_VALUES[i];
  inp.setAttribute('aria-label', `矩阵元素 ${Math.floor(i / 2) + 1},${(i % 2) + 1}`);
  inputs.push(inp);
  inputsGrid.appendChild(inp);
}
workshopPanel.appendChild(inputsGrid);

const quickRow = document.createElement('div');
quickRow.className = 'quick-row';
const QUICK: { label: string; values: [number, number, number, number] }[] = [
  { label: '单位矩阵', values: [1, 0, 0, 1] },
  { label: '旋转90°', values: [0, -1, 1, 0] },
  { label: '水平剪切', values: [1, 1, 0, 1] },
  { label: '投影', values: [1, 0, 0, 0] },
  { label: '清零', values: [0, 0, 0, 0] },
];
const quickBtns: HTMLButtonElement[] = [];
for (const q of QUICK) {
  const b = document.createElement('button');
  b.className = 'quick-btn';
  b.textContent = q.label;
  b.addEventListener('click', () => {
    inputs.forEach((inp, i) => {
      inp.value = String(q.values[i]);
    });
    schedulePreview();
  });
  quickRow.appendChild(b);
  quickBtns.push(b);
}
workshopPanel.appendChild(quickRow);

const previewLine = document.createElement('div');
previewLine.id = 'preview-line';
workshopPanel.appendChild(previewLine);

const warnLine = document.createElement('div');
warnLine.id = 'warn-line';
workshopPanel.appendChild(warnLine);

const playCustomBtn = document.createElement('button');
playCustomBtn.className = 'undo-btn';
playCustomBtn.textContent = `打出自定义矩阵（${CUSTOM_COST} 步）`;
workshopPanel.appendChild(playCustomBtn);

app.appendChild(workshopPanel);
// ---------- 面板结束 ----------

const statusLine = document.createElement('div');
statusLine.id = 'status-line';
app.appendChild(statusLine);

const hintLine = document.createElement('div');
hintLine.id = 'hint-line';
app.appendChild(hintLine);

const banner = document.createElement('div');
banner.id = 'banner';
const bannerText = document.createElement('span');
const bannerFormula = document.createElement('span');
bannerFormula.id = 'banner-formula';
banner.appendChild(bannerText);
banner.appendChild(bannerFormula);
app.appendChild(banner);

const view = createView(canvas);

let levelIndex = 0;
let state: GameState = createGame(levels[0]);
let hand: HandUI;
let displayM: Mat2 = IDENTITY;
let animating = false;
/** 失败时高亮的禁区下标（无则 null） */
let highlightZone: number | null = null;
/** 工坊预览的空间虚影矩阵（预览矩阵 · 当前矩阵），null 不画 */
let ghostM: Mat2 | null = null;
/** 当前四个输入是否全部合法（供打出按钮可用态） */
let inputsValid = true;
/** AI 请求进行中：禁用 AI 按钮，防止并发请求 */
let aiBusy = false;
/** 演示模式进行中：锁定全部手动输入（演示按钮变为"停止演示"） */
let demoRunning = false;
/** 演示取消标记：当前步骤结束后停止脚本 */
let demoCancelled = false;
/** 主线三关已通关标记 */
const beaten: boolean[] = [false, false, false];

function redraw(): void {
  drawScene(canvas, view, state.level, displayM, highlightZone, ghostM);
}

function updateLevelLine(): void {
  if (levelIndex < MAIN_LEVELS) {
    levelLine.textContent = `第 ${levelIndex + 1} / ${MAIN_LEVELS} 关 · ${state.level.name}`;
  } else if (levelIndex === WORKSHOP_INDEX) {
    levelLine.textContent = `${state.level.name} · 沙盒，不保证可解`;
  } else {
    levelLine.textContent = state.level.name;
  }
}

function updateStatusLine(): void {
  statusLine.textContent = `已用步数：${state.stepsUsed} / ${state.level.maxSteps}`;
}

/** 操作栈公式：M = A_k · ... · A_1，后打出的卡在左侧，最后乘 \vec{v} */
function stackLatex(): string | null {
  const n = state.stack.length;
  if (n === 0) return null;
  const symbols = state.stack
    .slice(-5)
    .reverse()
    .map((e) => e.card.symbol ?? 'A');
  const prefix = n > 5 ? '\\cdots \\cdot ' : '';
  return `${prefix}${symbols.join(' \\cdot ')} \\cdot \\vec{v}`;
}

function updateStackFormula(): void {
  const latex = stackLatex();
  if (latex === null) {
    stackFormula.textContent = '（空）';
  } else {
    stackFormula.textContent = '';
    renderLatex(latex, stackFormula);
  }
}

/** 失败横幅公式：投影压线时附 \det(A)=0 */
function updateBannerFormula(): void {
  bannerFormula.textContent = '';
  if (state.status === 'lost' && evaluate(state).reason === 'projection') {
    renderLatex('\\det(A)=0', bannerFormula);
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let timer = 0;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}

/** 公式统一入口：100ms 去抖；只在动画结束/撤销/重置/切关时触发，动画期间与逐帧都不碰 */
const refreshFormulas = debounce(() => {
  updateStackFormula();
  updateBannerFormula();
}, FORMULA_DEBOUNCE_MS);

function updateBanner(): void {
  bannerFormula.textContent = '';
  if (state.status === 'won') {
    bannerText.textContent = levelIndex === MAIN_LEVELS - 1 ? '开门！全部通关！' : '开门！';
    banner.className = 'won';
  } else if (state.status === 'lost') {
    const { reason } = evaluate(state);
    bannerText.textContent = `失败：${reason ? FAIL_TEXT[reason] : '未知原因'}`;
    banner.className = 'lost';
  } else {
    bannerText.textContent = '';
    banner.className = '';
  }
}

/** 统一刷新按钮可用态：动画或演示期间全部冻结，防止连点重复结算 */
function refreshControls(): void {
  hand.setEnabled(!animating && !demoRunning && state.status === 'playing');
  undoBtn.disabled = animating || demoRunning || state.stack.length === 0;
  resetBtn.disabled = animating || demoRunning;
  prevBtn.disabled = animating || demoRunning || levelIndex === 0;
  nextBtn.disabled = animating || demoRunning || levelIndex >= MAIN_LEVELS - 1 || !beaten[levelIndex];
  workshopBtn.style.display = beaten[MAIN_LEVELS - 1] && levelIndex !== WORKSHOP_INDEX ? '' : 'none';
  workshopBtn.disabled = animating || demoRunning;
  playCustomBtn.disabled =
    levelIndex !== WORKSHOP_INDEX || animating || demoRunning || state.status !== 'playing' || !inputsValid;
  for (const b of quickBtns) b.disabled = animating || demoRunning;
  hintBtn.disabled = aiBusy || animating || demoRunning;
  randomLevelBtn.disabled = aiBusy || animating || demoRunning;
  difficultySelect.disabled = animating || demoRunning;
}

// ---------- 工坊输入校验与预览 ----------
/** 解析四个输入：非空、Number.isFinite、|v| <= 2；非法输入标红 */
function parseInputs(): { valid: boolean; values: number[] } {
  let valid = true;
  const values = inputs.map((inp) => {
    const t = inp.value.trim();
    const v = Number(t);
    const ok = t !== '' && Number.isFinite(v) && Math.abs(v) <= 2;
    inp.classList.toggle('invalid', !ok);
    if (!ok) valid = false;
    return ok ? v : 0;
  });
  return { valid, values };
}

/** 输入防抖后刷新：LaTeX 预览、det/零矩阵警告、空间虚影。动画期间不更新虚影 */
function updatePreview(): void {
  if (levelIndex !== WORKSHOP_INDEX) return;
  const { valid, values } = parseInputs();
  inputsValid = valid;
  playCustomBtn.disabled = !valid || animating || state.status !== 'playing';
  if (!valid) {
    previewLine.textContent = '—';
    warnLine.textContent = '请输入 [-2, 2] 内的数字';
    ghostM = null;
    redraw();
    return;
  }
  const m: Mat2 = [
    [values[0], values[1]],
    [values[2], values[3]],
  ];
  renderLatex(toMatrixLatex(m), previewLine);
  if (values.every((v) => v === 0)) {
    warnLine.textContent = '零矩阵：整个空间被压成一个点';
  } else if (Math.abs(det(m)) <= 1e-9) {
    warnLine.textContent = '不可逆，空间会被压扁';
  } else {
    warnLine.textContent = '';
  }
  ghostM = animating ? null : multiply(m, displayM);
  redraw();
}
const schedulePreview = debounce(updatePreview, INPUT_DEBOUNCE_MS);
inputs.forEach((inp) => inp.addEventListener('input', schedulePreview));

function refreshAll(): void {
  updateLevelLine();
  updateStatusLine();
  updateBanner();
  refreshControls();
  refreshFormulas();
}

function loadLevelAt(index: number): void {
  levelIndex = index;
  state = createGame(levels[index]);
  displayM = state.M;
  highlightZone = null;
  ghostM = null;
  if (!demoRunning) hintLine.textContent = ''; // 演示期间保留解说字幕
  hand = renderHand(handEl, state.level.deck, onPlay);
  workshopPanel.style.display = index === WORKSHOP_INDEX ? '' : 'none';
  refreshAll();
  redraw();
  if (index === WORKSHOP_INDEX) updatePreview();
}

/** 出牌公共流程：逻辑立即结算，画面 300ms 插值，动画结束才展示判定与公式；onDone 供演示脚本等待 */
function startPlay(apply: () => void, onDone?: () => void): void {
  animating = true;
  highlightZone = null;
  ghostM = null;
  bannerText.textContent = '';
  bannerFormula.textContent = '';
  banner.className = '';
  refreshControls();

  const from = displayM;
  apply();
  hand.setRemaining(state.remaining);
  updateStatusLine();
  animateMatrix(
    from,
    state.M,
    ANIMATION_MS,
    (m) => {
      displayM = m;
      redraw();
    },
    () => {
      animating = false;
      displayM = state.M;
      if (state.status === 'won' && levelIndex < MAIN_LEVELS) beaten[levelIndex] = true;
      if (state.status === 'lost') highlightZone = evaluate(state).zoneIndex;
      redraw();
      updateBanner();
      refreshControls();
      refreshFormulas();
      schedulePreview();
      onDone?.();
    },
  );
}

function onPlay(deckIndex: number): void {
  if (animating || state.status !== 'playing') return;
  startPlay(() => applyCard(state, deckIndex));
}

playCustomBtn.addEventListener('click', () => {
  if (animating || state.status !== 'playing') return;
  const { valid, values } = parseInputs(); // 打出前二次校验
  if (!valid) return;
  const m: Mat2 = [
    [values[0], values[1]],
    [values[2], values[3]],
  ];
  startPlay(() => applyCustomCard(state, m));
});

undoBtn.addEventListener('click', () => {
  if (animating) return;
  undo(state);
  displayM = state.M; // 撤销立即吸附到位，不重播动画、不重复结算
  highlightZone = null;
  hand.setRemaining(state.remaining);
  refreshAll();
  redraw();
  schedulePreview();
});

resetBtn.addEventListener('click', () => {
  if (animating) return;
  reset(state);
  displayM = state.M;
  highlightZone = null;
  hand.setRemaining(state.remaining);
  refreshAll();
  redraw();
  schedulePreview();
});

prevBtn.addEventListener('click', () => {
  if (animating || levelIndex === 0) return;
  loadLevelAt(levelIndex - 1);
});

nextBtn.addEventListener('click', () => {
  if (animating || levelIndex >= MAIN_LEVELS - 1 || !beaten[levelIndex]) return;
  loadLevelAt(levelIndex + 1);
});

workshopBtn.addEventListener('click', () => {
  if (animating) return;
  loadLevelAt(WORKSHOP_INDEX);
});

hintBtn.addEventListener('click', () => {
  if (aiBusy || animating) return;
  aiBusy = true;
  refreshControls();
  hintLine.textContent = '思考中…';
  const reason = state.status === 'lost' ? evaluate(state).reason : null;
  getHint({ levelId: state.level.id, name: state.level.name, reason })
    .then((hint) => {
      hintLine.textContent = `提示：${hint}`;
    })
    .finally(() => {
      aiBusy = false;
      refreshControls();
    });
});

randomLevelBtn.addEventListener('click', () => {
  if (aiBusy || animating || demoRunning) return;
  const difficulty = difficultySelect.value as Difficulty;
  levels.push(loadLevel(generateRandomLevel(difficulty)));
  loadLevelAt(levels.length - 1);
});

// ---------- 演示模式 ----------
function demoSleep(ms: number): Promise<void> {
  return new Promise((res) => window.setTimeout(res, ms));
}

function demoPlay(deckIndex: number): Promise<void> {
  return new Promise((res) => {
    startPlay(() => applyCard(state, deckIndex), res);
  });
}

function demoFill(values: [number, number, number, number]): void {
  inputs.forEach((inp, i) => {
    inp.value = String(values[i]);
  });
  updatePreview(); // 同步刷新预览与空间虚影，不等防抖
}

function demoPlayCustom(): Promise<void> {
  return new Promise((res) => {
    const { valid, values } = parseInputs();
    if (!valid) {
      res();
      return;
    }
    const m: Mat2 = [
      [values[0], values[1]],
      [values[2], values[3]],
    ];
    startPlay(() => applyCustomCard(state, m), res);
  });
}

function demoReset(): void {
  reset(state);
  displayM = state.M;
  highlightZone = null;
  hand.setRemaining(state.remaining);
  refreshAll();
  redraw();
}

demoBtn.addEventListener('click', () => {
  if (demoRunning) {
    demoCancelled = true; // 当前步骤结束后停止
    return;
  }
  if (animating || aiBusy) return;
  demoRunning = true;
  demoCancelled = false;
  demoBtn.textContent = '停止演示';
  demoBtn.classList.add('running');
  refreshControls();
  runDemo({
    caption: (t) => {
      hintLine.textContent = `演示：${t}`;
    },
    load: (i) => loadLevelAt(i),
    play: demoPlay,
    fill: demoFill,
    playCustom: demoPlayCustom,
    reset: demoReset,
    sleep: demoSleep,
    cancelled: () => demoCancelled,
  }).finally(() => {
    const wasCancelled = demoCancelled;
    demoRunning = false;
    demoCancelled = false;
    demoBtn.textContent = '演示模式';
    demoBtn.classList.remove('running');
    if (wasCancelled) loadLevelAt(0); // 中途停止：回到第 1 关干净状态
    refreshControls();
  });
});

// ---------- 键盘快捷键：R 重置、Z 撤销、1-3 选卡（输入框聚焦时不触发） ----------
window.addEventListener('keydown', (e) => {
  if (demoRunning || animating || aiBusy) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === 'r' || e.key === 'R') {
    if (!resetBtn.disabled) resetBtn.click();
  } else if (e.key === 'z' || e.key === 'Z') {
    if (!undoBtn.disabled) undoBtn.click();
  } else if (e.key >= '1' && e.key <= '3') {
    const btn = handEl.querySelectorAll('button')[Number(e.key) - 1] as HTMLButtonElement | undefined;
    if (btn && !btn.disabled) btn.click();
  }
});

loadLevelAt(0);
