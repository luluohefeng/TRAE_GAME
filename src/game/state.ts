import { IDENTITY, multiply, type Mat2, type Vec2 } from './matrix.ts';
import { judge } from './judge.ts';

export interface Card {
  id: string;
  name: string;
  matrix: Mat2;
  /** 操作栈公式中的符号（如 R、S、P、M、C），缺省用 'A' */
  symbol?: string;
}

/** 轴对齐矩形禁区（世界坐标），固定不动，不随 M 变换 */
export interface ForbiddenZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 关卡发牌：一张卡 + 本关可用次数 */
export interface DeckEntry {
  card: Card;
  uses: number;
}

/** 随机事件（仅普通/困难模式的随机关卡出现） */
export type RandomEventId = 'seal' | 'supply' | 'contract' | 'fusion' | 'mirrorStorm';

export interface RandomEvent {
  id: RandomEventId;
  /** 事件大标题，如「封印」 */
  title: string;
  /** 事件效果说明（大字下方的小字） */
  description: string;
  /** 收起后左上角小字用的简短说明 */
  detail: string;
}

export interface Level {
  id: string;
  name: string;
  key: Vec2;
  lock: Vec2;
  forbidden: ForbiddenZone[];
  maxSteps: number;
  deck: DeckEntry[];
  /** 仅随机关卡可能带有事件 */
  event?: RandomEvent;
}

export type GameStatus = 'playing' | 'won' | 'lost';

/** 一张已打出的卡：预设卡消耗 1 步，自定义矩阵卡消耗 2 步 */
export interface PlayedCard {
  card: Card;
  cost: number;
  /** 预设卡在 level.deck 中的下标；自定义卡为 null（撤销时不返还次数） */
  deckIndex: number | null;
}

export interface GameState {
  level: Level;
  /** 操作栈，stack[0] 为最先打出的卡 */
  stack: PlayedCard[];
  /** 累积矩阵 M = A_k · ... · A_1，先打出的卡在右侧 */
  M: Mat2;
  stepsUsed: number;
  status: GameStatus;
  /** 每张预设卡的剩余可用次数，与 level.deck 对齐 */
  remaining: number[];
}

export function createGame(level: Level): GameState {
  return {
    level,
    stack: [],
    M: IDENTITY,
    stepsUsed: 0,
    status: 'playing',
    remaining: level.deck.map((e) => e.uses),
  };
}

/** 由操作栈重算累积矩阵：按打出顺序依次左乘 */
function recompute(stack: PlayedCard[]): Mat2 {
  let M: Mat2 = IDENTITY;
  for (const entry of stack) {
    M = multiply(entry.card.matrix, M);
  }
  return M;
}

function sumSteps(stack: PlayedCard[]): number {
  return stack.reduce((s, e) => s + e.cost, 0);
}

/** 打出 deck[index]：次数 -1、压栈（1 步）、左乘更新 M、重新判定。次数为 0 或非对局中打出会被忽略 */
export function applyCard(state: GameState, index: number): void {
  if (state.status !== 'playing') return;
  if (state.remaining[index] === undefined || state.remaining[index] <= 0) return;
  state.remaining[index]--;
  state.stack.push({ card: state.level.deck[index].card, cost: 1, deckIndex: index });
  state.stepsUsed = sumSteps(state.stack);
  state.M = recompute(state.stack);
  state.status = judge(state);
}

/** 自定义矩阵卡（矩阵工坊）：固定消耗 2 步，不占 deck 次数 */
export function applyCustomCard(state: GameState, matrix: Mat2): void {
  if (state.status !== 'playing') return;
  state.stack.push({
    card: { id: 'custom', name: '自定义矩阵', matrix, symbol: 'C' },
    cost: 2,
    deckIndex: null,
  });
  state.stepsUsed = sumSteps(state.stack);
  state.M = recompute(state.stack);
  state.status = judge(state);
}

/** 撤销：弹出最后一张卡（预设卡返还次数），重算 M 与步数，并重新判定（可从终局回退） */
export function undo(state: GameState): void {
  const entry = state.stack.pop();
  if (entry === undefined) return;
  if (entry.deckIndex !== null) state.remaining[entry.deckIndex]++;
  state.stepsUsed = sumSteps(state.stack);
  state.M = recompute(state.stack);
  state.status = judge(state);
}

/** 重置：清空栈、返还全部次数、恢复单位矩阵 */
export function reset(state: GameState): void {
  state.stack = [];
  state.stepsUsed = 0;
  state.M = IDENTITY;
  state.remaining = state.level.deck.map((e) => e.uses);
  state.status = 'playing';
}
