# 文档索引

本仓库是 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)（下称「上游」）的 Fork。文档分两类：

- **本 Fork 文档**：描述本仓库自己的功能、部署方式与维护约定，**以这里为准**。
- **上游沿用文档**：随上游代码一起合并进来，描述的是上游的功能或部署方式。文档顶部都标了说明；上游的最新版本请到[上游仓库](https://github.com/chthollyphile/folia-major/tree/main/docs)查看。

## 本 Fork 文档

| 文档 | 内容 |
| --- | --- |
| [根 README](../README.md) | Fork 概览、部署与启动、反馈约定 |
| [Fork 更新日志](../FORK_CHANGELOG.md) | Fork 自己的版本号规则与各版本变更（独立于上游版本号） |
| [Hi-Fi 直通](hifi.md) | **本 Fork 的重点功能**：Windows 桌面版的 WASAPI 直通、整数采样、重采样（rubato / SoXR）、真实链路读数、能保证与不能保证的边界 |
| [Fork 功能与修复清单](fork-features.md) | 相对上游多出来的全部功能与修复、已知限制、维护约定 |
| [Stage Remote 使用文档](stage-remote.md) | 服务器本机播放与多人遥控：角色、端口、启动脚本、令牌、账号共享、排错 |
| [QQ 音乐部署指南](qq-music-deployment.md) | QQ 音乐在 Vercel / Cloudflare / Docker 上的部署（本 Fork 单机形态直接用 `start-stage.cmd`，不需要这篇） |
| [技术与开发说明](technical.md) | 环境变量、本地开发、脚本、技术栈（含 Fork 侧的说明） |
| [CODEMAP](CODEMAP.md) | 自动生成的代码地图（`npm run codemap`） |

## 上游沿用文档（以上游为准）

| 文档 | 内容 |
| --- | --- |
| [local-library-management.md](local-library-management.md) | 本地音乐库导入、匹配、实体编辑 |
| [library-suites.md](library-suites.md) | 音乐库 core 与 UI suite 架构（本 Fork 在此基础上新增了手机 suite，见 [Fork 功能清单](fork-features.md)） |
| [lyric-api.md](lyric-api.md) · [kugou-omni-capability-alignment.md](kugou-omni-capability-alignment.md) · [ku-go-api-docs.md](ku-go-api-docs.md) | 歌词接口与酷狗能力说明 |
| [folium/](folium/) | Folium 模组系统：[API 参考](folium/api.md)、[开发与贡献指南](folium/contributing.md) |
| [desktop/](desktop/) · [wallpaper-mode.md](wallpaper-mode.md) · [bodian.md](bodian.md) · [linux-glyph-cache-fd-leak.md](linux-glyph-cache-fd-leak.md) | 桌面版相关（上游的说明；本 Fork 的桌面版见 [根 README](../README.md#下载桌面版windows) 与 [Hi-Fi 直通](hifi.md)） |
| [automix-memory-optimization.md](automix-memory-optimization.md) · [client-logging.md](client-logging.md) · [ponder-plan.md](ponder-plan.md) · [ponder-copy.md](ponder-copy.md) · [chore/](chore/) | 其他设计与诊断记录 |

另见：[Docker 部署](../deploy/docker/README.md) 与 [Sync Server](../sync-server/README.md)（上游文档，不含 Stage 中继）。
