import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { commandPinyinPlugin } from './dev/pinyin/commandPinyinPlugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 命令面板的检索索引在单测里也要读到构建期生成的拼音字典。
  plugins: [commandPinyinPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'node',
    // 第二消费者始终参与单测；test.env 与 vi.stubEnv 使用同一入口，可覆写验证关闭/生产边界。
    // 初始选择钉在 grid：现有用例都假设没选过 suite 的人看到网格（开发阶段的初始选择是 bravais）。
    // VITE_STAGE_RELAY 钉成空:它是部署环境的开关(.env.local 里会设),单测不能因此变成遥控模式。
    env: { VITE_LIBRARY_TUI: 'true', VITE_LIBRARY_INITIAL_SUITE: 'grid', VITE_STAGE_RELAY: '' },
    include: ['test/unit/**/*.test.ts']
  }
});
