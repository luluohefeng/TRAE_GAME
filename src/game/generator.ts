/**
 * 随机关卡生成器（替代原 AI 关卡）。
 * 思路：随机构造一条合法解路径 → 由路径终点得到锁的位置 → 用 BFS 校准最少步数，
 * 保证生成的关卡一定可解，且 maxSteps 恰好等于最少步数（不多不少）。
 */
import { IDENTITY, apply, isInvertible, multiply, type Mat2, type Vec2 } from './matrix.ts';
import { CARD_LIBRARY, type LevelJson } from './cards.ts';
import { bfsMinSteps, isValidLevelJson } from './validate.ts';
import { pickFallbackLevel } from '../ai/fallback.ts';

const CARD_IDS = Object.keys(CARD_LIBRARY);
const MAX_ATTEMPTS = 150;
/** 初始钥匙坐标范围（含） */
const KEY_RANGE = 3;
/** 关卡坐标绝对值上限 */
const BOUND = 8;

export type Difficulty = 'easy' | 'normal' | 'hard';

/** 难度规则：决定步数区间、牌堆规模、每张卡次数与禁区数量 */
export interface DifficultyRule {
  label: string;
  minSteps: number;
  maxSteps: number;
  deckMin: number;
  deckMax: number;
  usesMin: number;
  usesMax: number;
  zonesMin: number;
  zonesMax: number;
}

export const DIFFICULTY_RULES: Record<Difficulty, DifficultyRule> = {
  easy: {
    label: '简单',
    minSteps: 1,
    maxSteps: 2,
    deckMin: 2,
    deckMax: 2,
    usesMin: 1,
    usesMax: 1,
    zonesMin: 0,
    zonesMax: 1,
  },
  normal: {
    label: '普通',
    minSteps: 2,
    maxSteps: 3,
    deckMin: 2,
    deckMax: 3,
    usesMin: 1,
    usesMax: 2,
    zonesMin: 1,
    zonesMax: 1,
  },
  hard: {
    label: '困难',
    minSteps: 3,
    maxSteps: 5,
    deckMin: 3,
    deckMax: 4,
    usesMin: 1,
    usesMax: 2,
    zonesMin: 2,
    zonesMax: 2,
  },
};

let serial = 0;

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}
function samePoint(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** 抽一条合法出牌序列（遵守各卡可用次数），返回 deck 下标序列 */
function randomSequence(uses: number[], length: number): number[] {
  const left = uses.slice();
  const seq: number[] = [];
  for (let i = 0; i < length; i++) {
    const candidates: number[] = [];
    left.forEach((n, idx) => {
      if (n > 0) candidates.push(idx);
    });
    const idx = pickOne(candidates);
    left[idx]--;
    seq.push(idx);
  }
  return seq;
}

/** 按顺序作用卡牌，返回累积矩阵与每一步后的钥匙位置（path[0] 为初始位置） */
function playSequence(cardIds: string[], seq: number[], key: Vec2): { M: Mat2; path: Vec2[] } {
  let M: Mat2 = IDENTITY;
  const path: Vec2[] = [key];
  for (const idx of seq) {
    M = multiply(CARD_LIBRARY[cardIds[idx]].matrix, M);
    path.push(apply(M, key));
  }
  return { M, path };
}

/** 按难度生成一个候选关；不满足约束返回 null */
function buildCandidate(rule: DifficultyRule): LevelJson | null {
  const size = randInt(rule.deckMin, Math.min(rule.deckMax, CARD_IDS.length));
  const cardIds = shuffle([...CARD_IDS]).slice(0, size);
  const uses = cardIds.map(() => randInt(rule.usesMin, rule.usesMax));
  const totalUses = uses.reduce((a, b) => a + b, 0);
  if (totalUses < rule.minSteps) return null;
  const target = randInt(rule.minSteps, Math.min(rule.maxSteps, totalUses));

  let key: Vec2;
  do {
    key = [randInt(-KEY_RANGE, KEY_RANGE), randInt(-KEY_RANGE, KEY_RANGE)];
  } while (key[0] === 0 && key[1] === 0);

  const seq = randomSequence(uses, target);

  // 解路径中间出现不可逆矩阵会提前判负，直接丢弃该候选
  let midM: Mat2 = IDENTITY;
  for (const idx of seq.slice(0, -1)) {
    midM = multiply(CARD_LIBRARY[cardIds[idx]].matrix, midM);
    if (!isInvertible(midM)) return null;
  }

  const { path } = playSequence(cardIds, seq, key);
  const lock = path[path.length - 1];
  if (Math.abs(lock[0]) > BOUND || Math.abs(lock[1]) > BOUND) return null;
  if (samePoint(lock, key)) return null;
  if (path.some((p) => Math.abs(p[0]) > BOUND || Math.abs(p[1]) > BOUND)) return null;

  // 禁区放在“错误顺序”会到达、但正确解路径不会经过的位置，制造顺序陷阱
  const wrongPoints: Vec2[] = [];
  for (let i = 0; i < 12; i++) {
    const other = randomSequence(uses, randInt(1, target));
    for (const p of playSequence(cardIds, other, key).path.slice(1)) {
      if (Math.abs(p[0]) > BOUND || Math.abs(p[1]) > BOUND) continue;
      if (path.some((q) => samePoint(p, q))) continue;
      if (wrongPoints.some((q) => samePoint(p, q))) continue;
      wrongPoints.push(p);
    }
  }
  if (wrongPoints.length < rule.zonesMin) return null;
  const zoneCount = randInt(rule.zonesMin, Math.min(rule.zonesMax, wrongPoints.length));
  const forbidden = shuffle(wrongPoints)
    .slice(0, zoneCount)
    .map(([x, y]) => ({ x: x - 0.5, y: y - 0.5, w: 1, h: 1 }));

  const deck = cardIds.map((cardId, i) => ({ cardId, uses: uses[i] }));
  const min = bfsMinSteps({
    id: 'probe',
    name: 'probe',
    key,
    lock,
    forbidden,
    maxSteps: target,
    deck,
  });
  if (min === null || min < rule.minSteps || min > rule.maxSteps) return null;

  serial++;
  const level: LevelJson = {
    id: `random-${Date.now()}-${serial}`,
    name: `随机卡关 #${serial} · ${rule.label}`,
    key,
    lock,
    forbidden,
    maxSteps: min,
    deck,
  };
  if (!isValidLevelJson(level)) return null;
  // 复核：maxSteps 必须恰好等于最少步数
  return bfsMinSteps(level) === min ? level : null;
}

/** 随机关卡：按难度多次尝试；极端情况下回退预置关，绝不抛错 */
export function generateRandomLevel(difficulty: Difficulty = 'normal'): LevelJson {
  const rule = DIFFICULTY_RULES[difficulty] ?? DIFFICULTY_RULES.normal;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const level = buildCandidate(rule);
    if (level) return level;
  }
  return pickFallbackLevel();
}
