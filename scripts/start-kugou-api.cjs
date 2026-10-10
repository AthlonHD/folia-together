// scripts/start-kugou-api.cjs
// 启动自托管的酷狗音乐 API(kugoumusicapi,仓库依赖里已经装好)。
// 端口默认 4400,可用 KUGOU_PORT 覆盖;只监听本机,外部访问都经 Stage 中继的 /kugou 代理。
// 酷狗的登录态完全在客户端(token / userid / dfid 随请求的 cookie 参数带上),后端不保存会话,所以不需要状态目录。

const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.PORT = String(process.env.KUGOU_PORT || 4400);
process.env.HOST = process.env.HOST || '127.0.0.1';

// 后端默认把请求者的 IP 当作"来源 IP"发给酷狗;经中继转发时那是 127.0.0.1 这类私网地址,会被酷狗拒绝。
// Docker 镜像用 deploy/docker/scripts/patch-music-api-client-ip.mjs 改了 node_modules 里的这一行,
// 这里在内存里做同样的修改(加载 server.js 时替换源码),不去动 node_modules。
const serverFile = require.resolve('kugoumusicapi/server.js');
const before = '          let ip = req.ip;\n';
const after = "          let ip = '';\n";
const source = fs.readFileSync(serverFile, 'utf-8');
if (source.split(before).length - 1 === 1) {
  const patched = new Module(serverFile, module);
  patched.filename = serverFile;
  patched.paths = Module._nodeModulePaths(path.dirname(serverFile));
  patched._compile(source.replace(before, after), serverFile);
  patched.loaded = true;
  require.cache[serverFile] = patched;
} else {
  console.warn('[KuGou API] client IP patch target not found (kugoumusicapi version changed?); starting unpatched.');
}

console.log(`[KuGou API] listening on ${process.env.HOST}:${process.env.PORT}`);
require('kugoumusicapi/app.js');
