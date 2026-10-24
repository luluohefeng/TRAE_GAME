/**
 * 随机事件：仅在普通/困难模式生成随机关卡时出现。
 * 事件在生成阶段修改关卡（牌堆 / 步数 / 禁区），再用 BFS 复核可解性，
 * 因此主线关卡、教学关和简单难度都不受影响。
 */
import { CARD_LIBRARY, cardOfDeckEntry, type LevelJson } from './cards.ts';
import { multiply, type Mat2 } from './matrix.ts';
import type { Card, RandomEventId } from './state.ts';
import { bfsMinSteps, isValidLevelJson } from './validate.ts';
import { generateRandomLevel, type Difficulty } from './generator.ts';

const CARD_IDS = Object.keys(CARD_LIBRARY);
/** 反射类卡牌：镜像风暴只强化这些卡 */
const MIRROR_IDS = new Set(['mirrorX', 'mirrorY', 'swapXY']);
const EVENT_IDS: RandomEventId[] = ['seal', 'supply', 'contract', 'fusion', 'mirrorStorm'];
const MAX_EVENT_ATTEMPTS = 16;
const MIN_STEPS = 1;
const MAX_STEPS = 10;

let fusedSerial = 0;

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function cloneLevel(level: LevelJson): LevelJson {
  return JSON.parse(JSON.stringify(level)) as LevelJson;
}

function solvable(level: LevelJson): boolean {
  return isValidLevelJson(level) && bfsMinSteps(level) !== null;
}

function deckCardName(level: LevelJson, index: number): string {
  return cardOfDeckEntry(level.deck[index])?.name ?? '未知卡';
}

/** 封印：从卡池中排除一张卡后再生成，保证关卡本身可解 */
function trySeal(difficulty: Difficulty): LevelJson | null {
  const sealedId = pickOne(CARD_IDS);
  const pool = CARD_IDS.filter((id) => id !== sealedId);
  const level = generateRandomLevel(difficulty, pool);
  // 回退关可能仍包含被封印的卡，这种情况直接换一次尝试
  if (level.deck.some((d) => d.cardId === sealedId)) return null;
  if (!solvable(level)) return null;
  const sealedName = CARD_LIBRARY[sealedId].name;
  level.event = {
    id: 'seal',
    title: '封印',
    description: `本关封印「${sealedName}」，这张卡不会出现在牌堆中。`,
    detail: `封印 · ${sealedName}`,
  };
  return level;
}

/** 补给：给一张还有剩余次数的卡 +1 次；全满则补一张新卡 */
function trySupply(base: LevelJson): LevelJson | null {
  const level = cloneLevel(base);
  const candidates = level.deck
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.uses < 3);
  if (candidates.length > 0) {
    const { index } = pickOne(candidates);
    level.deck[index].uses++;
    if (!solvable(level)) return null;
    const name = deckCardName(level, index);
    level.event = {
      id: 'supply',
      title: '补给',
      description: `本关「${name}」额外获得 1 次使用。`,
      detail: `补给 · ${name} +1`,
    };
    return level;
  }
  if (level.deck.length >= 5) return null;
  const cardId = pickOne(CARD_IDS);
  level.deck.push({ cardId, uses: 1 });
  if (!solvable(level)) return null;
  const name = CARD_LIBRARY[cardId].name;
  level.event = {
    id: 'supply',
    title: '补给',
    description: `本关补给一张「${name}」卡（1 次使用）。`,
    detail: `补给 · 新增 ${name}`,
  };
  return level;
}

/** 在钥匙和锁之外找一个 1×1 禁区位置 */
function randomZone(level: LevelJson): { x: number; y: number; w: number; h: number } | null {
  const covers = (x: number, y: number, zone: { x: number; y: number; w: number; h: number }): boolean =>
    x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(Math.random() * 9) - 4;
    const y = Math.floor(Math.random() * 9) - 4;
    const zone = { x: x - 0.5, y: y - 0.5, w: 1, h: 1 };
    if (covers(level.key[0], level.key[1], zone)) continue;
    if (covers(level.lock[0], level.lock[1], zone)) continue;
    if (level.forbidden.some((z) => z.x === zone.x && z.y === zone.y)) continue;
    return zone;
  }
  return null;
}

/** 步数契约：随机执行「+2 步 / +1 禁区」或「-1 步 / 某卡 +1 次」 */
function tryContract(base: LevelJson): LevelJson | null {
  const useMoreSteps = Math.random() < 0.5;
  const level = cloneLevel(base);
  if (useMoreSteps) {
    if (level.maxSteps + 2 > MAX_STEPS) return null;
    level.maxSteps += 2;
    const zone = randomZone(level);
    if (!zone) return null;
    level.forbidden.push(zone);
    if (!solvable(level)) return null;
    level.event = {
      id: 'contract',
      title: '步数契约',
      description: '本关步数上限 +2，但新增 1 个禁区。',
      detail: '契约 · +2 步 / +1 禁区',
    };
    return level;
  }
  if (level.maxSteps - 1 < MIN_STEPS) return null;
  level.maxSteps -= 1;
  const candidates = level.deck
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.uses < 3);
  if (candidates.length === 0) return null;
  const { index } = pickOne(candidates);
  level.deck[index].uses++;
  if (!solvable(level)) return null;
  const name = deckCardName(level, index);
  level.event = {
    id: 'contract',
    title: '步数契约',
    description: `本关步数上限 -1，但「${name}」额外 +1 次使用。`,
    detail: `契约 · -1 步 / ${name} +1`,
  };
  return level;
}

/** 合卡祭：把两张卡按「先 A 后 B」合成一张内联合卡（矩阵 B·A） */
function tryFusion(base: LevelJson): LevelJson | null {
  if (base.deck.length < 2) return null;
  const pairs: [number, number][] = [];
  for (let i = 0; i < base.deck.length; i++) {
    for (let j = 0; j < base.deck.length; j++) {
      if (i !== j) pairs.push([i, j]);
    }
  }
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  for (const [i, j] of pairs) {
    const first = cardOfDeckEntry(base.deck[i]);
    const second = cardOfDeckEntry(base.deck[j]);
    if (!first || !second) continue;
    const level = cloneLevel(base);
    const firstSymbol = first.symbol ?? 'A';
    const secondSymbol = second.symbol ?? 'B';
    const fused: Card = {
      id: `fused-${Date.now()}-${fusedSerial++}`,
      name: `合卡 ${firstSymbol}${secondSymbol}`,
      matrix: multiply(second.matrix, first.matrix) as Mat2,
      symbol: `${firstSymbol}${secondSymbol}`,
    };
    const uses = Math.min(level.deck[i].uses, level.deck[j].uses);
    level.deck = level.deck.filter((_, index) => index !== i && index !== j);
    level.deck.push({ card: fused, uses });
    if (!solvable(level)) continue;
    level.event = {
      id: 'fusion',
      title: '合卡祭',
      description: `「${first.name}」与「${second.name}」已合成一张合卡（先 ${firstSymbol} 后 ${secondSymbol}，矩阵为 ${secondSymbol}·${firstSymbol}）。`,
      detail: `合卡 · ${firstSymbol}→${secondSymbol}`,
    };
    return level;
  }
  return null;
}

/** 镜像风暴：所有镜像卡 +1 次；没有镜像卡则补一张随机镜像卡 */
function tryMirrorStorm(base: LevelJson): LevelJson | null {
  const level = cloneLevel(base);
  let changed = 0;
  for (const entry of level.deck) {
    const id = entry.cardId ?? entry.card?.id;
    if (id && MIRROR_IDS.has(id) && entry.uses < 3) {
      entry.uses++;
      changed++;
    }
  }
  let addedName: string | null = null;
  if (changed === 0) {
    if (level.deck.length >= 5) return null;
    const cardId = pickOne([...MIRROR_IDS]);
    level.deck.push({ cardId, uses: 1 });
    addedName = CARD_LIBRARY[cardId].name;
  }
  if (!solvable(level)) return null;
  level.event = {
    id: 'mirrorStorm',
    title: '镜像风暴',
    description: addedName
      ? `本关获得一张「${addedName}」卡（1 次使用）。`
      : '本关所有镜像卡额外 +1 次使用。',
    detail: addedName ? `镜像风暴 · 新增 ${addedName}` : '镜像风暴 · 镜像卡 +1',
  };
  return level;
}

function tryEvent(difficulty: Difficulty, id: RandomEventId): LevelJson | null {
  if (id === 'seal') return trySeal(difficulty);
  const base = generateRandomLevel(difficulty);
  if (id === 'supply') return trySupply(base);
  if (id === 'contract') return tryContract(base);
  if (id === 'fusion') return tryFusion(base);
  return tryMirrorStorm(base);
}

/** 生成一个带随机事件的关卡；兜底为一定可解的「补给」事件 */
export function generateRandomEventLevel(difficulty: Difficulty): LevelJson {
  for (let i = 0; i < MAX_EVENT_ATTEMPTS; i++) {
    const level = tryEvent(difficulty, pickOne(EVENT_IDS));
    if (level) return level;
  }
  for (let i = 0; i < 10; i++) {
    const level = trySupply(generateRandomLevel(difficulty));
    if (level) return level;
  }
  const fallback = generateRandomLevel(difficulty);
  fallback.event = {
    id: 'supply',
    title: '补给',
    description: '本关获得一次额外补给。',
    detail: '补给',
  };
  return fallback;
}
