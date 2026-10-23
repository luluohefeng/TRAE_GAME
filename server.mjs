// AI 适配服务：托管 dist/ 静态产物 + /api/ai 转发到任意 OpenAI 兼容接口。
// 零依赖（仅 Node 内置模块）。API key 只从环境变量读取，绝不打印。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const AI_BASE_URL = (process.env.AI_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_API_KEY ?? '';
const AI_MODEL = process.env.AI_MODEL ?? 'deepseek-chat';
const UPSTREAM_TIMEOUT_MS = 20000;
const BODY_LIMIT = 64 * 1024;

/** 按场景调参：hint 限 64 token（30 字提示够用、响应快），level 生成 JSON 需要更多空间 */
const SCENE_PARAMS = {
  level: { maxTokens: 800, temperature: 1 },
  hint: { maxTokens: 64, temperature: 0.6 },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function callLLM(scene, system, payload) {
  const p = SCENE_PARAMS[scene] ?? SCENE_PARAMS.hint;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const resp = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        max_tokens: p.maxTokens,
        temperature: p.temperature,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}`);
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) throw new Error('响应缺少 content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function handleAI(req, res) {
  if (!AI_API_KEY) {
    send(res, 503, { error: '未配置 AI_API_KEY，前端将自动回退本地内容' });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: '请求体不是合法 JSON' });
    return;
  }
  const scene = body?.scene;
  const ok =
    (scene === 'level' || scene === 'hint') &&
    typeof body?.system === 'string' &&
    (typeof body?.payload === 'object' || typeof body?.payload === 'string');
  if (!ok) {
    send(res, 400, { error: '请求格式错误：需要 {scene, system, payload}' });
    return;
  }
  const content = await callLLM(scene, body.system, body.payload);
  send(res, 200, { content });
}

async function serveStatic(res, urlPath) {
  const rel = decodeURIComponent(urlPath).split('?')[0];
  let filePath = normalize(join(DIST, rel === '/' ? 'index.html' : rel));
  if (!filePath.startsWith(DIST + sep)) {
    send(res, 403, { error: 'forbidden' });
    return;
  }
  let content;
  try {
    content = await readFile(filePath);
  } catch {
    if (extname(rel) === '') {
      // SPA 回退：无扩展名路径统一回 index.html
      try {
        content = await readFile(join(DIST, 'index.html'));
      } catch {
        send(res, 404, { error: 'dist 不存在，请先执行 npm run build' });
        return;
      }
    } else {
      send(res, 404, { error: 'not found' });
      return;
    }
  }
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(content);
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  try {
    if (method === 'POST' && url === '/api/ai') {
      await handleAI(req, res);
    } else if (method === 'GET' && url === '/api/health') {
      send(res, 200, { ok: true, model: AI_MODEL, keyConfigured: AI_API_KEY !== '' });
    } else if (method === 'GET') {
      await serveStatic(res, url);
    } else {
      send(res, 405, { error: 'method not allowed' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[api] ${method} ${url} 失败: ${msg}`);
    if (!res.headersSent) {
      const status = msg.includes('too large')
        ? 413
        : e instanceof Error && e.name === 'AbortError'
          ? 504
          : 502;
      send(res, status, { error: msg });
    } else {
      res.end();
    }
  } finally {
    console.log(`${method} ${url} -> ${res.statusCode} (${Date.now() - started}ms)`);
  }
});

process.on('unhandledRejection', (e) => console.warn('[unhandledRejection]', e));

server.listen(PORT, HOST, () => {
  console.log(`矩阵折叠密室服务已启动: http://${HOST}:${PORT}`);
  console.log(
    `AI 模型: ${AI_MODEL} @ ${AI_BASE_URL}（key ${AI_API_KEY ? '已配置' : '未配置，/api/ai 返回 503，前端自动回退本地'}）`,
  );
  console.log('静态产物来自 dist/，若 404 请先执行 npm run build');
});
