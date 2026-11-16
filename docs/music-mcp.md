# 桌面音乐 MCP

Folia 桌面版可以为同机 Agent 提供音乐 API。它使用当前 Folia 用户配置里已经登录的平台账号，支持获取音乐资料和在指定来源执行操作。Folia 需要在运行，窗口可以收起。MCP **无需**启动 Stage 多人同控服务，也**不向局域网开放**。

本能力是 Together Fork 功能（自 v1.9.0），网页版 / Stage Host 没有对应监听端口。

## 启用

打开桌面版「设置 → 连接与集成 → 音乐 MCP」，打开开关。显示「运行中」后，点击「复制 Agent 配置」，把 JSON 粘贴到 Agent 的 MCP 配置中。地址旁的复制按钮只复制地址，完整配置包含鉴权所需的密钥。

需要建单或控制播放时，打开「允许写入和播放控制」。关闭 MCP 后会停止接收请求，记住两个开关的状态。设置变更即时生效。系统支持加密存储时，Folia 会保存生成的连接密钥。使用临时密钥时，设置页会提示重启后如有需要重新复制配置。默认端口为 `38451`，绑定在本机 `127.0.0.1`。

源码调试也支持启动环境变量 `FOLIA_MCP_TOKEN`、`FOLIA_MCP_WRITE` 和 `FOLIA_MCP_PORT`。没有保存过开关状态时，可用至少 32 个字符的 `FOLIA_MCP_TOKEN` 开启，并用 `FOLIA_MCP_WRITE=1` 允许写入。端口可通过 `FOLIA_MCP_PORT` 覆盖。

命令面板可搜「音乐 MCP」跳到设置锚点（仅 Electron）。

### Streamable HTTP（推荐）

配置地址 `http://127.0.0.1:38451/mcp`，从「复制 Agent 配置」中获取 `Authorization` 请求头。使用支持本地地址和自定义鉴权头的 MCP 客户端。

复制出的配置形如：

```json
{
  "mcpServers": {
    "folia-music": {
      "type": "http",
      "url": "http://127.0.0.1:38451/mcp",
      "headers": {
        "Authorization": "Bearer <连接密钥>"
      }
    }
  }
}
```

把这段粘进 Cursor / 其他 Agent 的 MCP 配置即可。密钥不要提交到仓库或发到公开聊天。

### stdio

Agent 启动命令为 `node <仓库绝对路径>/electron/mcp/stdio.cjs`，从「复制 Agent 配置」的 `Authorization` 值取出 `Bearer ` 后面的密钥作为子进程环境变量 `FOLIA_MCP_TOKEN`，修改端口时也提供 `FOLIA_MCP_PORT`。这条命令要求本机有 Node.js 和仓库依赖。随安装版的脚本在 `resources/app.asar/electron/mcp/stdio.cjs`，可用 `Folia.exe` 作命令，传入该脚本的绝对路径并设置 `ELECTRON_RUN_AS_NODE=1`。

stdio 桥只是把标准输入输出转成对上述 HTTP 端点的调用；桌面版仍须先开启 MCP。

## 安全边界

| 约束 | 行为 |
| --- | --- |
| 绑定地址 | 只听 `127.0.0.1`，不接受外网或局域网连接 |
| 鉴权 | 每个请求需 `Authorization: Bearer <token>`；Host / Origin 与 token 对不上直接 `403` |
| 写入闸门 | 未开「允许写入和播放控制」时，写入类与播放控制工具不会注册 / 会拒绝 |
| 并发写 | 同一时刻只允许一个写入请求在途 |
| 播放器就绪 | 主窗口未就绪或正在导航时拒绝；在途请求上限 8；超时约 90 秒 |
| 密钥存储 | 系统支持加密存储时，密钥以 `MUSIC_MCP_TOKEN_SEALED` 密封保存；否则为临时密钥，重启后可能变化 |

不要把 MCP 端口做端口转发，也不要把连接密钥写进可被他人读取的配置。

## 读取资料和写入目标平台

先运行 `list_sources` 查看当前登录状态及各平台的能力。工具覆盖搜索、歌曲和歌词、专辑和艺人、歌单和收藏、Folia 近期播放、平台推荐、探索、偏好、标记喜欢和订阅。平台专有接口通过 `list_platform_api`、`describe_platform_api` 发现，当前原始接口目录来自网易云已有的白名单。Agent 可用 `play_track` 点歌或排入队列，用 `control_playback` 控制播放。

例如向 Agent 发出「分析我常听的歌，生成 30 首夜间通勤歌曲，保存到 QQ 音乐」。Agent 可以按以下流程操作。

1. 从多个平台读取歌单和收听信息，并寻找合适曲目。
2. 在 QQ 音乐搜索候选，或使用 `match_playlist_tracks` 匹配源曲目。匹配保留歧义和缺失项，Agent 可以从候选中继续核对。
3. 用 `create_playlist` 把目标平台 ID、歌单名称和目标平台曲目 ID 写到账号，保留本次操作的 `requestId`。
4. 查看返回值里的原平台歌单 ID、支持时的链接、已回读核对的曲目和未写入的曲目。补加时用 `add_playlist_tracks`、原歌单 ID 和新的请求 ID。

创建原平台歌单需要接入平台的创建和加歌能力。当前检测到网易云、QQ 音乐、Spotify 和 FnMusic 提供了对应的 Omni 入口。其他平台的具体可用操作由 `list_sources` 返回。网易云通过该功能建单时默认设为私密。

同一播放器页面中，相同账号和 `requestId` 的重复创建返回同一结果。重启、重载或平台未返回歌单 ID 时，先用 `list_playlists` 确认创建结果，再决定是否重试。命令以创建、加歌和回读三步执行，部分失败时已创建的歌单仍可继续添加。

Navidrome 可搜索、读取并通过 `create_playlist` 保存到已配置的服务器。可用 `local` 读取本地音乐和歌单，用 `folia` 读取跨平台歌单。明确要保存到 Folia 时，使用 `create_folia_playlist` 并提交带来源的曲目 ID。

其他平台的原始端点目录、库内歌单的部分写操作和 Folia 尚未接入的能力仍待补齐。各平台的独立登录和授权由桌面版完成。

## 工具一览

工具定义在 `electron/mcp/tools.cjs`；实际调度在渲染进程 `src/components/app/musicMcp/musicMcpBridge.ts`（经 Omni，不另开旁路）。关闭写入开关时，标「写」的工具不会出现在 Agent 侧。

### 发现与账户资料（读）

| 工具 | 作用 |
| --- | --- |
| `list_sources` | 列出平台 / 本地 / Folia 库的登录状态与能力（含能否建单、原始 API 后端信息） |
| `list_account_collections` | 账号已加载的集合（含排行等特殊集合） |
| `list_playlists` | 刷新并列出账号歌单 |
| `list_liked_tracks` | 喜欢的曲目 ID |
| `list_listening_history` | Folia 记录的该账号近期收听 |
| `search_music` | 按平台搜索歌曲 / 歌单 / 专辑 |
| `get_track` / `get_lyrics` | 曲目元数据与歌词 |
| `get_collection` / `list_collection_tracks` / `list_artist_albums` | 歌单、专辑、艺人及其曲目 |
| `get_platform_library` | 账号专辑库或云盘 |
| `get_recommendations` | 日推、私人 FM、探索、偏好、风格等（由 `kind` 区分） |
| `list_platform_api` / `describe_platform_api` / `read_platform_api` | 发现并调用白名单内的只读平台原始端点 |

### 匹配、建单与账户写入（写）

| 工具 | 作用 |
| --- | --- |
| `match_playlist_tracks` | 把源曲目解析到目标平台 ID（保留歧义） |
| `create_playlist` | 在指定平台账号新建歌单并加歌，需 `requestId` |
| `create_folia_playlist` | 明确保存到 Folia 跨平台歌单 |
| `add_playlist_tracks` / `remove_playlist_tracks` | 向已有平台歌单加减歌 |
| `set_track_like` / `set_subscription` | 喜欢 / 订阅 |
| `set_recommendation_preferences` / `set_daily_style` / `dislike_track` | 推荐相关写入 |
| `write_platform_api` | 白名单内的平台原始写端点 |

### 播放（读 / 写）

| 工具 | 作用 |
| --- | --- |
| `get_playback` | 当前曲、播放状态与队列一页 |
| `play_track` | 点播或入队（写） |
| `control_playback` | 暂停 / 继续 / 上下曲 / seek（写） |

播放控制走主进程已有的 Stage 播放路径，仍要求主窗口可用。

## 环境变量与存储键

| 名称 | 含义 |
| --- | --- |
| `FOLIA_MCP_TOKEN` | 启动时注入连接密钥（32–256 个可打印 ASCII）；未持久化过开关时可据此开启 |
| `FOLIA_MCP_WRITE` | 设为 `1` 时，在上述首次开启路径下同时打开写入 |
| `FOLIA_MCP_PORT` | 覆盖默认端口 `38451`（1024–65535） |
| `MUSIC_MCP_ENABLED` / `MUSIC_MCP_WRITE` | 主进程 store 中的两个开关 |
| `MUSIC_MCP_TOKEN_SEALED` | 系统加密后的连接密钥 |

## 架构与代码位置

```
Agent (HTTP 或 stdio 桥)
  → electron/mcp/server.cjs（loopback + token + 工具注册）
  → IPC music-mcp-request
  → src/components/app/musicMcp/musicMcpBridge.ts
  → omni / 本地库 / 跨平台歌单
  → IPC music-mcp-complete
```

| 路径 | 职责 |
| --- | --- |
| `electron/mcp/server.cjs` | 监听、鉴权、设置 IPC、与渲染进程配对请求 |
| `electron/mcp/tools.cjs` | 工具名、描述、Zod 入参、读写标注 |
| `electron/mcp/stdio.cjs` | stdio ↔ Streamable HTTP 转发 |
| `src/components/app/musicMcp/` | 渲染侧调度、曲目视图、建单回读、本地 / Folia 库 |
| `src/components/modal/settings/pages/integration/MusicMcpRows.tsx` | 设置页 |
| `test/unit/musicMcp/` | 设置、库访问、原生建单相关单测 |

IPC 通道 `music-mcp-settings` / `music-mcp-complete` 登记为 first-party（仅主播放器顶层页面）。

## 排错

- **显示端口占用 / 不可用**：换 `FOLIA_MCP_PORT`，或结束占用 `38451` 的进程后重开开关。
- **Agent 连不上**：确认 Folia 桌面版在跑、开关为「运行中」，配置里的 URL 与 Bearer 与「复制 Agent 配置」一致；不要改 Host / 加 Origin。
- **只有读工具、没有建单**：打开「允许写入和播放控制」，然后让 Agent 重新拉取工具列表。
- **建单失败**：先 `list_sources` 确认该平台 `createPlaylist` 为真且已登录；曲目 ID 必须是**目标平台**的 ID（可先 `match_playlist_tracks`）。
- **提示 player not ready**：等主窗口加载完成；勿在启动闪屏阶段调用。
- **临时密钥提示**：本机无加密存储，或密封失败；重启后如连不上需重新复制配置。

功能清单里的交叉条目见 [Fork 功能与修复清单](fork-features.md#92-桌面音乐-mcp)。
