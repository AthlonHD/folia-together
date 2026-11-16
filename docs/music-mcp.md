# 桌面音乐 MCP

Folia 桌面版可以为同机 Agent 提供音乐 API。它使用当前 Folia 用户配置里已经登录的平台账号，支持获取音乐资料和在指定来源执行操作。Folia 需要在运行，窗口可以收起。MCP 无需启动 Stage 多人同控服务。

## 启用

打开桌面版「设置 → 连接与集成 → 音乐 MCP」，打开开关。显示「运行中」后，点击「复制 Agent 配置」，把 JSON 粘贴到 Agent 的 MCP 配置中。地址旁的复制按钮只复制地址，完整配置包含鉴权所需的密钥。

需要建单或控制播放时，打开「允许写入和播放控制」。关闭 MCP 后会停止接收请求，记住两个开关的状态。设置变更即时生效。系统支持加密存储时，Folia 会保存生成的连接密钥。使用临时密钥时，设置页会提示重启后如有需要重新复制配置。默认端口为 `38451`，绑定在本机 `127.0.0.1`。

源码调试也支持启动环境变量 `FOLIA_MCP_TOKEN`、`FOLIA_MCP_WRITE` 和 `FOLIA_MCP_PORT`。没有保存过开关状态时，可用至少 32 个字符的 `FOLIA_MCP_TOKEN` 开启，并用 `FOLIA_MCP_WRITE=1` 允许写入。端口可通过 `FOLIA_MCP_PORT` 覆盖。

### Streamable HTTP

配置地址 `http://127.0.0.1:38451/mcp`，从「复制 Agent 配置」中获取 `Authorization` 请求头。使用支持本地地址和自定义鉴权头的 MCP 客户端。

### stdio

Agent 启动命令为 `node <仓库绝对路径>/electron/mcp/stdio.cjs`，从「复制 Agent 配置」的 `Authorization` 值取出 `Bearer ` 后面的密钥作为子进程环境变量 `FOLIA_MCP_TOKEN`，修改端口时也提供 `FOLIA_MCP_PORT`。这条命令要求本机有 Node.js 和仓库依赖。随安装版的脚本在 `resources/app.asar/electron/mcp/stdio.cjs`，可用 `Folia.exe` 作命令，传入该脚本的绝对路径并设置 `ELECTRON_RUN_AS_NODE=1`。

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
