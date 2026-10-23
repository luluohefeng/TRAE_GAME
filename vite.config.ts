// 开发模式代理：npm run dev (5173) 时把 /api/ai 转发到 8787 的适配服务，
// 与生产模式（npm run serve 同源托管）行为一致。
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/ai': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
