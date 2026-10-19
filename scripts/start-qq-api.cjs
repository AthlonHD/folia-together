// scripts/start-qq-api.cjs
// 启动自托管的 QQ 音乐 API(@yakult-green-tea/qq-music-api,仓库依赖里已经装好)。
// 启动逻辑与桌面版是同一份(electron/qq/qqApiStartup.cjs 的 startQqApi:关掉自动打开浏览器和更新检查、等到真正监听成功才算启动、
// 之后的套接字错误只记日志不崩进程);这里只负责服务端特有的部分:登录态用文件加密保存。
// 登录态加密保存在 %USERPROFILE%\.folia-qq(与仓库分开,不会被提交);加密密钥第一次启动时随机生成。
// 桌面版的登录态则由应用经系统凭据(safeStorage)保存,所以这一块两边不同,是有意的。
// 端口默认 4300,可用 QQ_PORT 覆盖。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startQqApi } = require('../electron/qq/qqApiStartup.cjs');

const stateDir = process.env.QQ_STATE_DIR || path.join(os.homedir(), '.folia-qq');
fs.mkdirSync(stateDir, { recursive: true });

const secretFile = path.join(stateDir, 'session-secret');
let secret = process.env.QQ_SESSION_SECRET;
if (!secret) {
  if (!fs.existsSync(secretFile)) {
    fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  secret = fs.readFileSync(secretFile, 'utf-8').trim();
}

// 包在被 require 的那一刻读这些环境变量,所以要在 startQqApi 之前设好,并且保留(startQqApi 只还原它自己改的那几个)。
process.env.QQ_SESSION_SECRET = secret;
process.env.QQ_AUTH_SESSION_PATH ||= path.join(stateDir, 'qq-session.enc');

const port = Number(process.env.QQ_PORT) || 4300;
console.log(`[QQ API] state in ${stateDir}, listening on port ${port}`);

startQqApi({ port, stateFilePath: process.env.QQ_AUTH_STATE_PATH || path.join(stateDir, 'qq-device.json') }).then(
  () => console.log(`[QQ API] listening on port ${port}`),
  (error) => {
    console.error('[QQ API] could not start:', error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
