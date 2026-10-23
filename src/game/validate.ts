import { IDENTITY, apply, isInvertible, multiply, type Mat2, type Vec2 } from './matrix.ts';
import { CARD_LIBRARY, type LevelJson } from './cards.ts';
import { WIN_THRESHOLD } from './judge.ts';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isVec2(v: unknown): v is Vec2 {
  return Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber);
}

/** 关卡 JSON 的本地 Schema 校验（含规模上限，防止 BFS 状态爆炸） */
export function isValidLevelJson(j: unknown): j is LevelJson {
  if (typeof j !== 'object' || j === null) return false;
  const l = j as Record<string, unknown>;
  if (typeof l.id !== 'string' || typeof l.name !== 'string') return false;
  if (!isVec2(l.key) || !isVec2(l.lock)) return false;
  if (!Array.isArray(l.forbidden) || l.forbidden.length > 3) return false;
  for (const z of l.forbidden as unknown[]) {
    if (typeof z !== 'object' || z === null) return false;
    const zone = z as Record<string, unknown>;
    if (![zone.x, zone.y, zone.w, zone.h].every(isFiniteNumber)) return false;
    if ((zone.w as number) <= 0 || (zone.h as number) <= 0) return false;
    if (Math.abs(zone.x as number) > 10 || Math.abs(zone.y as number) > 10) return false;
  }
  if (!Number.isInteger(l.maxSteps) || (l.maxSteps as number) < 1 || (l.maxSteps as number) > 10) {
    return false;
  }
  if (!Array.isArray(l.deck) || l.deck.length < 1 || l.deck.length > 5) return false;
  for (const d of l.deck as unknown[]) {
    if (typeof d !== 'object' || d === null) return false;
    const e = d as Record<string, unknown>;
    if (typeof e.cardId !== 'string' || !(e.cardId in CARD_LIBRARY)) return false;
    if (!Number.isInteger(e.uses) || (e.uses as number) < 1 || (e.uses as number) > 3) return false;
  }
  return true;
}

/** BFS 节点数保护上限，超过视为不可解 */
const BFS_NODE_CAP = 300_000;

/**
 * BFS 求最少步数（预设卡每步 1）。状态 = 累积矩阵 + 各卡剩余次数。
 * 判定顺序与 judge 一致：禁区（死路）→ 胜利 → 不可逆（死路）→ 超步数（不再扩展）。
 * 不可解返回 null。
 */
export function bfsMinSteps(level: LevelJson): number | null {
  interface Node {
    M: Mat2;
    remaining: number[];
    steps: number;
  }
  const inZone = (p: Vec2): boolean =>
    level.forbidden.some(
      (z) => p[0] >= z.x && p[0] <= z.x + z.w && p[1] >= z.y && p[1] <= z.y + z.h,
    );
  const keyOf = (M: Mat2, remaining: number[]): string =>
    `${M[0][0].toFixed(6)},${M[0][1].toFixed(6)},${M[1][0].toFixed(6)},${M[1][1].toFixed(
      6,
    )}|${remaining.join(',')}`;

  const queue: Node[] = [
    { M: IDENTITY, remaining: level.deck.map((d) => d.uses), steps: 0 },
  ];
  const seen = new Set<string>();
  let head = 0;
  while (head < queue.length) {
    if (head > BFS_NODE_CAP) return null;
    const node = queue[head++];
    const key = keyOf(node.M, node.remaining);
    if (seen.has(key)) continue;
    seen.add(key);
    const pos = apply(node.M, level.key);
    if (inZone(pos)) continue;
    if (Math.hypot(pos[0] - level.lock[0], pos[1] - level.lock[1]) < WIN_THRESHOLD) {
      return node.steps;
    }
    if (!isInvertible(node.M)) continue;
    if (node.steps >= level.maxSteps) continue;
    level.deck.forEach((d, i) => {
      if (node.remaining[i] <= 0) return;
      const card = CARD_LIBRARY[d.cardId];
      const remaining = node.remaining.slice();
      remaining[i]--;
      queue.push({ M: multiply(card.matrix, node.M), remaining, steps: node.steps + 1 });
    });
  }
  return null;
}
