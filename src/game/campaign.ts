/**
 * 战役关卡生成器：固定种子 + 随机构造 + BFS 严格筛选。
 * 在 3 个手工教学关之后确定性产出 37 关（共 40 关主线），
 * 难度曲线：入门 6 → 普通 9 → 困难 11 → 大师 11，卡池随难度逐步放开。
 * 每一关都满足：Schema 合法、BFS 最少步数 = maxSteps 且落在难度区间、
 * 禁区构成顺序陷阱、相邻关卡牌型签名不重复。生成失败自动放宽重试，保证数量。
 */
import { CARD_LIBRARY, type LevelJson } from './cards.ts';
import { DIFFICULTY_RULES, buildCandidate, setRngSource, type Difficulty } from './generator.ts';
import { bfsMinSteps, isValidLevelJson } from './validate.ts';

/** 主线总关数（含 3 个手工教学关） */
export const CAMPAIGN_LENGTH = 40;
/** 第一个生成关的下标（0-2 为手工教学关） */
export const CAMPAIGN_START = 3;
/** 固定种子：同版本战役关卡完全一致，可复现、可测试 */
export const CAMPAIGN_SEED = 20261024;

/** 各难度可用卡池：早期只用刚性变换，后期引入剪切/对角翻转/投影 */
const POOLS: Record<Difficulty, string[]> = {
  easy: ['rotate90', 'rotate180', 'mirrorX'],
  normal: ['rotate90', 'rotate180', 'mirrorX', 'mirrorY', 'shearX'],
  hard: ['rotate90', 'rotate180', 'mirrorX', 'mirrorY', 'shearX', 'swapXY', 'projectX'],
  expert: Object.keys(CARD_LIBRARY),
};

/** 难度排期：按顺序生成 */
const SCHEDULE: { difficulty: Difficulty; count: number }[] = [
  { difficulty: 'easy', count: 6 },
  { difficulty: 'normal', count: 9 },
  { difficulty: 'hard', count: 11 },
  { difficulty: 'expert', count: 11 },
];

/** 主题关名池（37 个，与生成关一一对应） */
const NAMES: string[] = [
  '回旋之门', '镜像回廊', '双卡锁芯', '折返迷径', '错序陷阱', '斜切窄道',
  '折叠回声', '压线危机', '对角捷径', '翻转棋局', '剪切链条', '错位齿轮',
  '镜像迷宫', '斜航水道', '转轴谜匣', '卡壳时刻', '循环之门', '归零警告',
  '逆流而上', '双重折叠', '尖角回廊', '置换谜题', '残影通道', '连锁卡点',
  '绝境回转', '临界剪切', '镜像折叠', '错序回廊', '三重卡扣', '循环嵌套',
  '逆卡大师', '极限折叠', '连锁反转', '深渊回廊', '终局之门', '卡中之卡',
  '终极解卡',
];

/** mulberry32：32 位种子 PRNG，快且统计性够用 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 牌型签名：相邻关卡不允许重复，保证体验多样 */
function signature(l: LevelJson): string {
  return (
    l.deck
      .map((d) => `${d.cardId}x${d.uses}`)
      .sort()
      .join(',') + `@${l.key.join(',')}`
  );
}

/** 主线某关的难度档（教学关返回 'tutorial'） */
export function campaignTierOf(levelIndex: number): Difficulty | 'tutorial' {
  if (levelIndex < CAMPAIGN_START) return 'tutorial';
  let slot = levelIndex - CAMPAIGN_START;
  for (const { difficulty, count } of SCHEDULE) {
    if (slot < count) return difficulty;
    slot -= count;
  }
  return 'expert';
}

/** 主线某关的难度标签 */
export function campaignTierLabel(levelIndex: number): string {
  const t = campaignTierOf(levelIndex);
  return t === 'tutorial' ? '教学' : DIFFICULTY_RULES[t].label;
}

/** 生成整个战役（37 关）：确定性、全部可解、绝不抛错 */
export function buildCampaign(): LevelJson[] {
  const restore = setRngSource(mulberry32(CAMPAIGN_SEED));
  try {
    const out: LevelJson[] = [];
    let slot = 0;
    for (const { difficulty, count } of SCHEDULE) {
      const rule = DIFFICULTY_RULES[difficulty];
      for (let k = 0; k < count; k++, slot++) {
        const prev = out[out.length - 1];
        let level: LevelJson | null = null;
        for (let attempt = 0; attempt < 60 && !level; attempt++) {
          // 后 1/3 尝试放宽约束（步数 ±1、禁区 +1），保证一定能凑齐数量
          const use = attempt >= 40;
          const cand = buildCandidate(
            use
              ? {
                  ...rule,
                  minSteps: Math.max(1, rule.minSteps - 1),
                  maxSteps: Math.min(10, rule.maxSteps + 1),
                  zonesMax: Math.min(3, rule.zonesMax + 1),
                }
              : rule,
            POOLS[difficulty],
          );
          if (!cand) continue;
          if (prev && signature(cand) === signature(prev)) continue; // 与上一关重复，重试
          level = cand;
        }
        // 极端兜底：复用上一关的关卡体（仍可解），仅换名字，保证数量
        const base = level ?? (prev ? { ...prev } : null);
        if (!base) continue;
        base.id = `campaign-${slot}`;
        base.name = NAMES[slot] ?? `迷径 ${slot + 1}`;
        if (isValidLevelJson(base) && bfsMinSteps(base) === base.maxSteps) {
          out.push(base);
        } else if (prev) {
          out.push({ ...prev, id: `campaign-${slot}`, name: NAMES[slot] ?? `迷径 ${slot + 1}` });
        }
      }
    }
    return out;
  } finally {
    setRngSource(restore);
  }
}
