// scripts/start-qq-api.cjs
// 启动自托管的 QQ 音乐 API(@yakult-green-tea/qq-music-api,仓库依赖里已经装好)。
// 登录态加密保存在 %USERPROFILE%\.folia-qq(与仓库分开,不会被提交);加密密钥第一次启动时随机生成。
// 端口默认 4300,可用 QQ_PORT 覆盖。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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

process.env.PORT = String(process.env.QQ_PORT || 4300);
process.env.QQ_SESSION_SECRET = secret;
process.env.QQ_AUTH_STATE_PATH ||= path.join(stateDir, 'qq-device.json');
process.env.QQ_AUTH_SESSION_PATH ||= path.join(stateDir, 'qq-session.enc');

console.log(`[QQ API] state in ${stateDir}, listening on port ${process.env.PORT}`);
// 包的 exports 不开放子路径,按文件路径加载
require(path.join(__dirname, '..', 'node_modules', '@yakult-green-tea', 'qq-music-api', 'dist', 'src', 'app.js'));
