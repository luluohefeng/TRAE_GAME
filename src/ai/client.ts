import { HINT_SYSTEM_PROMPT } from './prompt.ts';
import { pickFallbackHint } from './fallback.ts';

/** AI 服务端点；离线或失败时一律回退本地，绝不阻塞游戏 */
const AI_ENDPOINT = '/api/ai';
const AI_TIMEOUT_MS = 3000;

/**
 * 调用提示 AI：3 秒超时；JSON 解析失败重试 1 次；仍失败抛错（由调用方回退本地）。
 */
async function callHintAI<T>(payload: unknown, parse: (content: string) => T): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: 'hint', system: HINT_SYSTEM_PROMPT, payload }),
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
    const text = await callHintAI(context, (t) => t);
    const clean = sanitizeHint(text);
    if (clean) return clean;
  } catch (e) {
    console.warn('AI 提示不可用，使用本地提示', e);
  }
  return pickFallbackHint(context.reason);
}
