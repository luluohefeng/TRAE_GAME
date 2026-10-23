import { IDENTITY, apply, isInvertible, multiply, type Mat2, type Vec2 } from '../game/matrix.ts';
import { WIN_THRESHOLD } from '../game/judge.ts';
import { CARD_LIBRARY, loadLevel, type LevelJson } from '../game/cards.ts';
import type { Level } from '../game/state.ts';
import { HINT_SYSTEM_PROMPT, LEVEL_SYSTEM_PROMPT } from './prompt.ts';
import { pickFallbackHint, pickFallbackLevel } from './fallback.ts';

/** AI 服务端点；离线或失败时一律回退本地，绝不阻塞游戏 */
const AI_ENDPOINT = '/api/ai';
const AI_TIMEOUT_MS = 3000;

export type AIScene = 'level' | 'hint';

/**
 * 调 AI：每次 3 秒超时；JSON 解析失败重试 1 次；仍失败抛错（由调用方回退本地）。
 * parse 负责把 content 文本转成目标结构（level：JSON.parse；hint：原文）。
 */
async function callAI<T>(
  scene: AIScene,
  payload: unknown,
  parse: (content: string) => T,
): Promise<T> {
  const system = scene === 'level' ? LEVEL_SYSTEM_PROMPT : HINT_SYSTEM_PROMPT;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene, system, payload }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const envelope = (await resp.json()) as { content?: unknown };
      if (typeof envelope.content !== 'string') throw new Error('响应缺少 content 字段');
      return parse(envelope.content);
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isVec2(v: unknown): v is Vec2 {
  return Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber);
}

/** AI 生成关卡的本地 Schema 校验（含规模上限，防止 BFS 状态爆炸） */
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

/** BFS 节点数保护上限，超过视为非法关 */
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

/** AI 生成关卡：Schema 校验 + BFS（最少步数 = maxSteps），不通过丢弃并无感回退预置关 */
export async function generateLevel(payload: unknown = {}): Promise<Level> {
  try {
    const json = await callAI('level', payload, (text) => JSON.parse(text) as unknown);
    if (isValidLevelJson(json) && bfsMinSteps(json) === json.maxSteps) {
      return loadLevel(json);
    }
    console.warn('AI 关卡未通过校验，已丢弃并回退预置关', json);
  } catch (e) {
    console.warn('AI 不可用，使用预置关卡', e);
  }
  return loadLevel(pickFallbackLevel());
}

/** 清洗 AI 提示：去引号、单行、1~30 字；不合格返回 null */
export function sanitizeHint(text: string): string | null {
  const t = text
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (t.length === 0 || [...t].length > 30) return null;
  if (/[\r\n]/.test(t)) return null;
  return t;
}

export interface HintContext {
  levelId: string;
  name?: string;
  reason?: string | null;
}

/** AI 失败提示：一句 30 字内中文、不给操作序列；失败或不合格无感回退本地提示。永不 reject */
export async function getHint(context: HintContext): Promise<string> {
  try {
    const text = await callAI('hint', context, (t) => t);
    const clean = sanitizeHint(text);
    if (clean) return clean;
  } catch (e) {
    console.warn('AI 提示不可用，使用本地提示', e);
  }
  return pickFallbackHint(context.reason);
}
