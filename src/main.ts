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
  type RandomEvent,
} from './game/state.ts';
import { evaluate } from './game/judge.ts';
import { loadLevel, type LevelJson } from './game/cards.ts';
import { animateMatrix } from './game/animation.ts';
import { createView, drawScene } from './render/canvas.ts';
import { renderHand, type HandUI } from './render/cards.ts';
import { renderLatex, toMatrixLatex } from './render/latex.ts';
import { DIFFICULTY_RULES, generateRandomLevel, type Difficulty } from './game/generator.ts';
import { generateRandomEventLevel } from './game/events.ts';
import {
  buildCampaign,
  campaignTierLabel,
  campaignTierOf,
  CAMPAIGN_LENGTH,
} from './game/campaign.ts';
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
  ...buildCampaign().map((j) => loadLevel(j)),
  loadLevel(workshopJson as LevelJson),
];
const MAIN_LEVELS = CAMPAIGN_LENGTH; // 3 教学关 + 37 生成关
const WORKSHOP_INDEX = levels.length - 1;

const ANIMATION_MS = 300;
const FORMULA_DEBOUNCE_MS = 100;
const INPUT_DEBOUNCE_MS = 100;
const CUSTOM_COST = 2;
const FAIL_TEXT: Record<string, string> = {
  forbidden: '钥匙被卡死在禁区',
  steps: '步数耗尽，钥匙还卡着',
  projection: '投影压线，空间塌了',
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app root element not found');
}

const title = document.createElement('h1');
title.textContent = '解卡 · 矩阵密室';
app.appendChild(title);

const subtitle = document.createElement('div');
subtitle.className = 'subtitle';
subtitle.textContent = '世界卡住了，打出你的卡。';
app.appendChild(subtitle);

const levelLine = document.createElement('div');
levelLine.id = 'level-line';
app.appendChild(levelLine);

const canvasWrap = document.createElement('div');
canvasWrap.id = 'canvas-wrap';

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
// 逻辑 800×600（4:3），位图按 DPR 放大，绘制/命中恒用逻辑坐标，缩放不变形不模糊
const CANVAS_DPR = Math.max(1, window.devicePixelRatio || 1);
canvas.width = Math.round(800 * CANVAS_DPR);
canvas.height = Math.round(600 * CANVAS_DPR);
canvasWrap.appendChild(canvas);
app.appendChild(canvasWrap);

// ---------- 随机事件展示 ----------
const eventOverlay = document.createElement('div');
eventOverlay.id = 'event-overlay';
eventOverlay.hidden = true;
const eventCard = document.createElement('div');
eventCard.className = 'event-card';
const eventKicker = document.createElement('div');
eventKicker.className = 'event-kicker';
eventKicker.textContent = '随机事件';
const eventTitle = document.createElement('div');
eventTitle.className = 'event-title';
const eventDesc = document.createElement('div');
eventDesc.className = 'event-desc';
const eventHint = document.createElement('div');
eventHint.className = 'event-hint';
eventHint.textContent = '按空格收起';
eventCard.appendChild(eventKicker);
eventCard.appendChild(eventTitle);
eventCard.appendChild(eventDesc);
eventCard.appendChild(eventHint);
eventOverlay.appendChild(eventCard);
canvasWrap.appendChild(eventOverlay);

const eventBadge = document.createElement('div');
eventBadge.id = 'event-badge';
eventBadge.hidden = true;
const eventBadgeTitle = document.createElement('strong');
const eventBadgeDesc = document.createElement('span');
eventBadgeDesc.className = 'event-badge-desc';
eventBadge.appendChild(eventBadgeTitle);
eventBadge.appendChild(eventBadgeDesc);
canvasWrap.appendChild(eventBadge);
// ---------- 事件展示结束 ----------

const stackLine = document.createElement('div');
stackLine.id = 'stack-line';
const stackLabel = document.createElement('span');
stackLabel.textContent = '卡栈（最近 5 步）：';
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
workshopBtn.textContent = '造卡工坊';
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
randomLevelBtn.textContent = '随机卡关';
const demoBtn = document.createElement('button');
demoBtn.className = 'nav-btn demo-btn';
demoBtn.textContent = '演示模式';
const selectBtn = document.createElement('button');
selectBtn.className = 'nav-btn select-btn';
selectBtn.textContent = '选关';
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
controls.appendChild(selectBtn);
app.appendChild(controls);

// ---------- 选关界面（全屏覆盖层） ----------
const levelSelect = document.createElement('div');
levelSelect.id = 'level-select';
levelSelect.classList.add('screen');

const selectHeader = document.createElement('div');
selectHeader.className = 'level-select-header';
const selectTitle = document.createElement('div');
selectTitle.className = 'level-select-title';
selectTitle.textContent = '选关';
const selectProgress = document.createElement('div');
selectProgress.className = 'level-select-progress';
const selectHint = document.createElement('div');
selectHint.className = 'level-select-hint';
selectHint.textContent = '通关上一关解锁下一关 · 点击任意已解锁关卡开始';
selectHeader.appendChild(selectTitle);
selectHeader.appendChild(selectProgress);
levelSelect.appendChild(selectHeader);

// 难度图例：与格子配色一一对应
const selectLegend = document.createElement('div');
selectLegend.className = 'level-select-legend';
const LEGEND: { tier: string; label: string }[] = [
  { tier: 'tutorial', label: '教学' },
  { tier: 'easy', label: '入门' },
  { tier: 'normal', label: '普通' },
  { tier: 'hard', label: '困难' },
  { tier: 'expert', label: '大师' },
];
for (const item of LEGEND) {
  const swatch = document.createElement('span');
  swatch.className = `level-select-swatch tier-${item.tier}`;
  const label = document.createElement('span');
  label.className = 'level-select-legend-label';
  label.textContent = item.label;
  selectLegend.appendChild(swatch);
  selectLegend.appendChild(label);
}
levelSelect.appendChild(selectHint);
levelSelect.appendChild(selectLegend);

const selectGrid = document.createElement('div');
selectGrid.className = 'level-select-grid';
levelSelect.appendChild(selectGrid);

const selectBackBtn = document.createElement('button');
selectBackBtn.className = 'nav-btn';
selectBackBtn.textContent = '返回游戏';
levelSelect.appendChild(selectBackBtn);

app.appendChild(levelSelect);
let selectOpen = false;

/** 重建 40 格选关网格：按难度着色，通关打 ✓，未解锁置灰 */
function renderLevelSelect(): void {
  selectGrid.textContent = '';
  const done = beaten.filter(Boolean).length;
  selectProgress.textContent = `已通关 ${done} / ${MAIN_LEVELS}`;
  for (let i = 0; i < MAIN_LEVELS; i++) {
    const cell = document.createElement('button');
    const tier = i < 3 ? 'tutorial' : campaignTierOf(i);
    cell.className = `level-cell tier-${tier}`;
    cell.textContent = String(i + 1);
    cell.title = `${campaignTierLabel(i)} · ${levels[i].name}`;
    if (beaten[i]) {
      cell.classList.add('done');
      cell.title = `已通关 · ${cell.title}`;
    }
    if (i === levelIndex) cell.classList.add('current');
    cell.disabled = !isUnlocked(i) || demoRunning;
    cell.addEventListener('click', () => {
      if (animating || demoRunning) return;
      closeLevelSelect();
      loadLevelAt(i);
    });
    selectGrid.appendChild(cell);
  }
}

function openLevelSelect(): void {
  selectOpen = true;
  levelSelect.classList.add('open');
  renderLevelSelect();
}

function closeLevelSelect(): void {
  selectOpen = false;
  levelSelect.classList.remove('open');
}

selectBtn.addEventListener('click', () => {
  if (animating || demoRunning) return;
  if (selectOpen) closeLevelSelect();
  else openLevelSelect();
});

selectBackBtn.addEventListener('click', () => {
  if (animating || demoRunning) return;
  closeLevelSelect();
});

// 选关界面打开时 Esc 关闭
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selectOpen) closeLevelSelect();
});

// ---------- 矩阵工坊面板 ----------
const workshopPanel = document.createElement('div');
workshopPanel.id = 'workshop-panel';

const panelTitle = document.createElement('div');
panelTitle.className = 'workshop-title';
panelTitle.textContent = `造卡工坊 · 自定义一张 2×2 矩阵卡（元素 [-2, 2]，打出消耗 ${CUSTOM_COST} 步，不保证关卡可解）`;
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
    for (const qb of quickBtns) qb.classList.remove('selected');
    b.classList.add('selected');
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
playCustomBtn.textContent = `打出这张卡（${CUSTOM_COST} 步）`;
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
const bannerTitle = document.createElement('div');
bannerTitle.className = 'banner-title';
const bannerSub = document.createElement('div');
bannerSub.className = 'banner-sub';
const bannerMeta = document.createElement('div');
bannerMeta.className = 'banner-meta';
const bannerFormula = document.createElement('span');
bannerFormula.id = 'banner-formula';
banner.append(bannerTitle, bannerSub, bannerMeta, bannerFormula);
app.appendChild(banner);

const view = createView(canvas);

let levelIndex = 0;
let state: GameState = createGame(levels[0]);
let hand: HandUI;
let displayM: Mat2 = IDENTITY;
let animating = false;
/** 随机事件大字卡展开中：暂时锁住手牌与导航，按空格收起 */
let eventOpen = false;
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
/** 主线已通关标记（localStorage 持久化） */
const SAVE_KEY = 'jieka-progress-v1';
function loadProgress(): boolean[] {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(arr) && arr.length === MAIN_LEVELS && arr.every((v) => typeof v === 'boolean')) {
      return arr as boolean[];
    }
  } catch {
    /* 存档损坏则重新开始 */
  }
  return new Array(MAIN_LEVELS).fill(false);
}
const beaten: boolean[] = loadProgress();
function saveProgress(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(beaten));
  } catch {
    /* 写入失败（隐私模式等）静默忽略 */
  }
}
/** 关卡解锁：第 1 关恒开放，其余需通关前一关 */
function isUnlocked(index: number): boolean {
  return index === 0 || beaten[index - 1];
}

function redraw(): void {
  drawScene(canvas, view, state.level, displayM, highlightZone, ghostM, state.status === 'won');
}

function showEventBadge(event: RandomEvent): void {
  eventBadgeTitle.textContent = event.title;
  eventBadgeDesc.textContent = event.detail;
  eventBadge.hidden = false;
  requestAnimationFrame(() => eventBadge.classList.add('visible'));
}

function hideEventBadge(): void {
  eventBadge.hidden = true;
  eventBadge.classList.remove('visible');
}

/** 隐藏事件（切到无事件关卡时调用） */
function hideEvent(): void {
  eventOpen = false;
  eventOverlay.hidden = true;
  eventOverlay.classList.remove('collapsed');
  hideEventBadge();
}

/** 展开事件大字卡 */
function showEvent(event: RandomEvent): void {
  eventTitle.textContent = event.title;
  eventDesc.textContent = event.description;
  hideEventBadge();
  eventOverlay.hidden = false;
  eventOverlay.classList.remove('collapsed');
  eventOpen = true;
  refreshControls();
  // 控制区在画布下方，生成事件时先把画布滚到视口中央，收起后左上角小字才不会跑到屏幕外
  canvasWrap.scrollIntoView({ block: 'center' });
}

/** 空格/点击：大字卡缩小为画布左上角小字 */
function collapseEvent(): void {
  if (eventOverlay.hidden || eventOverlay.classList.contains('collapsed')) return;
  eventOverlay.classList.add('collapsed');
  const event = state.level.event;
  if (event) showEventBadge(event);
  eventOpen = false;
  refreshControls();
  window.setTimeout(() => {
    if (eventOverlay.classList.contains('collapsed')) eventOverlay.hidden = true;
  }, 260);
}

/** 加载关卡时同步事件状态：有事件则只显示左上角小字，无事件则清空 */
function syncEventUI(index: number): void {
  const event = levels[index].event;
  hideEvent();
  if (event) showEventBadge(event);
}

eventOverlay.addEventListener('click', collapseEvent);

function updateLevelLine(): void {
  if (levelIndex < MAIN_LEVELS) {
    levelLine.textContent = `第 ${levelIndex + 1} / ${MAIN_LEVELS} 关 · ${state.level.name} · ${campaignTierLabel(levelIndex)}`;
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
    bannerTitle.textContent = '解卡成功！';
    bannerSub.textContent = '密室已开启';
    const steps = `通关步数 ${state.stepsUsed} / ${state.level.maxSteps}`;
    const progress =
      levelIndex < MAIN_LEVELS ? ` · 关卡进度 ${levelIndex + 1} / ${MAIN_LEVELS}` : '';
    bannerMeta.textContent = steps + progress;
    banner.className = 'won';
  } else if (state.status === 'lost') {
    const { reason } = evaluate(state);
    bannerTitle.textContent = `卡住了：${reason ? FAIL_TEXT[reason] : '未知原因'}`;
    bannerSub.textContent = '';
    bannerMeta.textContent = '';
    banner.className = 'lost';
  } else {
    bannerTitle.textContent = '';
    bannerSub.textContent = '';
    bannerMeta.textContent = '';
    banner.className = '';
  }
}

/** 统一刷新按钮可用态：动画或演示期间全部冻结，防止连点重复结算 */
function refreshControls(): void {
  const locked = animating || demoRunning || eventOpen;
  hand.setEnabled(!locked && state.status === 'playing');
  undoBtn.disabled = locked || state.stack.length === 0;
  resetBtn.disabled = locked;
  prevBtn.disabled = locked || levelIndex === 0;
  nextBtn.disabled = locked || levelIndex >= MAIN_LEVELS - 1 || !beaten[levelIndex];
  // 通关后突出【下一关】：禁用时不加主按钮样式
  nextBtn.classList.toggle('primary', state.status === 'won' && !nextBtn.disabled);
  workshopBtn.style.display = beaten[MAIN_LEVELS - 1] && levelIndex !== WORKSHOP_INDEX ? '' : 'none';
  workshopBtn.disabled = locked;
  playCustomBtn.disabled =
    levelIndex !== WORKSHOP_INDEX || locked || state.status !== 'playing' || !inputsValid;
  for (const b of quickBtns) b.disabled = locked;
  hintBtn.disabled = aiBusy || locked;
  randomLevelBtn.disabled = aiBusy || locked;
  difficultySelect.disabled = locked;
  selectBtn.disabled = locked;
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
  syncEventUI(index);
  workshopPanel.style.display = index === WORKSHOP_INDEX ? '' : 'none';
  refreshAll();
  renderLevelSelect();
  redraw();
  if (index === WORKSHOP_INDEX) updatePreview();
}

/** 出牌公共流程：逻辑立即结算，画面 300ms 插值，动画结束才展示判定与公式；onDone 供演示脚本等待 */
function startPlay(apply: () => void, onDone?: () => void): void {
  animating = true;
  highlightZone = null;
  ghostM = null;
  bannerTitle.textContent = '';
  bannerSub.textContent = '';
  bannerMeta.textContent = '';
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
      if (state.status === 'won' && levelIndex < MAIN_LEVELS) {
        beaten[levelIndex] = true;
        saveProgress();
        renderLevelSelect();
      }
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
  if (eventOpen || animating || state.status !== 'playing') return;
  startPlay(() => applyCard(state, deckIndex));
}

playCustomBtn.addEventListener('click', () => {
  if (eventOpen || animating || state.status !== 'playing') return;
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
  // 只有普通/困难会带随机事件；简单模式保持无事件
  const withEvent = difficulty === 'normal' || difficulty === 'hard';
  const level = loadLevel(
    withEvent ? generateRandomEventLevel(difficulty) : generateRandomLevel(difficulty),
  );
  levels.push(level);
  loadLevelAt(levels.length - 1);
  if (level.event) showEvent(level.event);
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
    load: (i) => loadLevelAt(i === -1 ? WORKSHOP_INDEX : i),
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

// ---------- 键盘快捷键：空格收起事件、R 重置、Z 撤销、1-3 选卡（输入框聚焦时不触发） ----------
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  // 事件大字卡展开时：空格收起，其他游戏快捷键暂时失效
  if (eventOpen) {
    if (!typing && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault();
      collapseEvent();
    }
    return;
  }
  if (demoRunning || animating || aiBusy || selectOpen) return;
  if (typing) return;
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
