import type { Vec2 } from './matrix.ts';
import type { Card, ForbiddenZone, Level, RandomEvent } from './state.ts';

/** 卡牌库：id → 卡牌定义（矩阵为主，tex 留给后续 KaTeX 阶段） */
export const CARD_LIBRARY: Record<string, Card> = {
  rotate90: {
    id: 'rotate90',
    name: '旋转 90°',
    matrix: [[0, -1], [1, 0]],
    symbol: 'R',
  },
  shearX: {
    id: 'shearX',
    name: '水平剪切',
    matrix: [[1, 1], [0, 1]],
    symbol: 'S',
  },
  projectX: {
    id: 'projectX',
    name: 'X 轴投影',
    matrix: [[1, 0], [0, 0]],
    symbol: 'P',
  },
  mirrorX: {
    id: 'mirrorX',
    name: 'X 轴镜像',
    matrix: [[1, 0], [0, -1]],
    symbol: 'M',
  },
  mirrorY: {
    id: 'mirrorY',
    name: 'Y 轴镜像',
    matrix: [[-1, 0], [0, 1]],
    symbol: 'M',
  },
  rotate180: {
    id: 'rotate180',
    name: '旋转 180°',
    matrix: [[-1, 0], [0, -1]],
    symbol: 'R',
  },
  swapXY: {
    id: 'swapXY',
    name: '对角翻转',
    matrix: [[0, 1], [1, 0]],
    symbol: 'F',
  },
};

/** 牌堆条目：预设卡用 cardId 引用卡库；合卡等运行时卡可直接内联 */
export interface DeckJson {
  cardId?: string;
  card?: Card;
  uses: number;
}

/** 关卡 JSON 的原始结构（deck 用 cardId 引用卡库，也允许事件生成的合卡内联） */
export interface LevelJson {
  id: string;
  name: string;
  key: Vec2;
  lock: Vec2;
  forbidden: ForbiddenZone[];
  maxSteps: number;
  deck: DeckJson[];
  event?: RandomEvent;
}

/** 解析一条牌堆条目；card 优先，其次 cardId 查卡库 */
export function cardOfDeckEntry(d: DeckJson): Card | null {
  if (d.card) return d.card;
  if (typeof d.cardId === 'string') return CARD_LIBRARY[d.cardId] ?? null;
  return null;
}

/** 校验内联卡（事件生成的合卡）结构合法 */
export function isValidCard(c: unknown): c is Card {
  if (typeof c !== 'object' || c === null) return false;
  const card = c as Record<string, unknown>;
  if (typeof card.id !== 'string' || typeof card.name !== 'string') return false;
  if (!Array.isArray(card.matrix) || card.matrix.length !== 2) return false;
  for (const row of card.matrix) {
    if (!Array.isArray(row) || row.length !== 2) return false;
    if (!row.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  }
  if (card.symbol !== undefined && typeof card.symbol !== 'string') return false;
  return true;
}

/** JSON → Level：解析 cardId 或内联卡；未知卡牌或次数非正直接报错（关卡必须预置且可验证） */
export function loadLevel(json: LevelJson): Level {
  return {
    id: json.id,
    name: json.name,
    key: json.key,
    lock: json.lock,
    forbidden: json.forbidden,
    maxSteps: json.maxSteps,
    event: json.event,
    deck: json.deck.map((d) => {
      const card = cardOfDeckEntry(d);
      if (!card) {
        throw new Error(`未知卡牌：${d.cardId ?? d.card?.id ?? 'inline'}（关卡 ${json.id}）`);
      }
      if (!Number.isInteger(d.uses) || d.uses <= 0) {
        throw new Error(`卡牌次数必须为正整数：${card.id}（关卡 ${json.id}）`);
      }
      return { card, uses: d.uses };
    }),
  };
}
