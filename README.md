<p align="center">
  <img src="https://github.com/user-attachments/assets/b5d0e863-48be-497b-b0e9-4bd8d8ce9bf0" alt="Folia" width="100%" />
</p>

<div align="center">

# Folia · Together

Lyrics Reimagined // 辞曲新境 —— 一台机器放歌，一群人遥控

[![Fork of folia-major](https://img.shields.io/badge/fork%20of-chthollyphile%2Ffolia--major-blue?logo=github)](https://github.com/chthollyphile/folia-major)
[![License](https://img.shields.io/github/license/chthollyphile/folia-major)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

[Hi-Fi 直通](docs/hifi.md)
·
[桌面音乐 MCP](docs/music-mcp.md)
·
[本 Fork 的功能与修复](docs/fork-features.md)
·
[下载桌面版](#下载桌面版windows)
·
[部署与启动](#部署与启动)
·
[Stage Remote 使用文档](docs/stage-remote.md)
·
[文档索引](docs/README.md)
·
[上游仓库](https://github.com/chthollyphile/folia-major)

</div>

## 项目简介

Folia 是一个以全屏沉浸式歌词播放为核心的在线音乐播放器（上游项目：[chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)），支持网易云、QQ 音乐、酷狗、Navidrome 和本地音乐库，桌面端还支持波点音乐、YouTube Music、Spotify 和汽水音乐，通过智能歌词匹配、AI 生成配色主题以及多种全屏歌词动画，提供独特的听歌体验。

**本仓库（[AthlonHD/folia-together](https://github.com/AthlonHD/folia-together)）是它的长期维护 Fork**。GitHub 默认分支与开发分支均为 `stage-remote`（`upstream-sync` 只用来对齐上游，不要在上面开发）。在保留上游全部播放与歌词能力的基础上，围绕这些方向做了扩展：

- **Hi-Fi 直通（Windows 桌面版，重点之一）**：绕开浏览器音频栈，独占时绕过 Windows 共享混音器，支持 WASAPI 独占 / 共享输出；整数采样、只做一次重采样（rubato 或 SoXR 可选）、链路显示稳态 PCM 判定和转换情况。详见下方「重点：Hi-Fi 直通」。
- **桌面音乐 MCP（桌面版，重点之一）**：本机 Agent 经 loopback 读取多平台资料、建单与控播；不依赖 Stage 遥控。详见下方「重点：桌面音乐 MCP」。
- **一台机器放歌、一群人遥控**：服务器（或常开的电脑）上的浏览器出声，朋友和家人用手机、电脑打开同一个网址点歌、切歌、管队列。
- **手机也能完整使用**：独立的手机布局，功能与电脑一致。

上游的更新会持续合并进来；**凡是与上游重复的说明（桌面版安装包、Vercel / Cloudflare 一键部署、Folium 模组系统、Sync Server、使用指南等），本仓库不再重复维护，统一链接到上游查看**。本 Fork 的部署方式与上游不同，请以本文「部署与启动」为准。

上游另有一套 **mpv HiFi**（主要服务本地 / Navidrome，在线歌仍走浏览器）；本 Fork **直通**是自研 WASAPI helper，Windows 上可覆盖更多音源。两套并存、不是同一个功能。Windows 开启直通时后续起播优先 helper；要用 mpv 请先关直通。对照表见 [与上游 mpv HiFi 的关系](docs/hifi.md#与上游-mpv-hifi-的关系)。

## 重点：Hi-Fi 直通

> Windows 桌面版专有（设置 → 播放控制 → 直通模式）。网页版与手机布局不受影响。完整说明、实测数据与边界见 **[Hi-Fi 直通文档](docs/hifi.md)**。

浏览器的音频输出有两层不由应用控制的环节：Chromium 的音频栈，和 Windows 共享混音器（混音、必要时重采样）。直通模式把声音交给独立的原生播放器 `folia-audio-helper.exe`，自己解码、WASAPI 直接送到声卡驱动，并如实告诉你这一路做了什么。

- **WASAPI 独占 / 共享**：独占绕过混音器、设备接受什么格式就给什么格式；共享给只认共享流的虚拟声卡（如 WDM2VST）。
- **整数 PCM 优先**：解码结果转成 32 位左对齐整数，优先整数输出；重采样和浮点输出回退可能经过浮点处理。需要降位时四舍五入并标明。
- **只转一次，整数倍优先**：设备不接受原采样率时才重采样，优先整数倍（44.1k→88.2k/176.4k，48k→96k/192k），helper 内只做**一次**（共享混音器和驱动仍可能有后续处理）；rubato（默认）或 SoXR（libsoxr）可选，升采样误差约 −194 dBFS，已压到 32 位整数的取整底噪。
- **如实的链路读数**：已知整数双声道在独占、不重采样、不降位时显示「稳态 PCM 未改动」；共享输出标明经过 Windows 混音器，未知位深不作逐位承诺。防爆音渐变及驱动、设备内部处理不在此判定范围。
- **边下边放、切歌即停**：下到前 512 KB 就出声，点切歌当下旧歌立刻停。
- **多种音源**：在线歌曲、本地文件、Navidrome，以及 Spotify / YouTube Music 解密后的流；超过双声道回落普通播放，避免丢弃环绕声道。
- **老实说边界**：播放器这一段是透明的，但「设备接受」不等于「设备内部不转换」，有损源也不会变无损；端到端是否逐位一致取决于你的下游（如虚拟声卡）。这些都写在文档里。

## 重点：桌面音乐 MCP

> 桌面版专有（设置 → 连接与集成 → 音乐 MCP）。Folia 需在运行（窗口可收起）；**不需要** Stage 中继。完整工具表、鉴权与排错见 **[桌面音乐 MCP](docs/music-mcp.md)**。

把已登录平台账号上的音乐能力交给同机 Agent（Cursor 等）：读歌单 / 收藏 / 推荐 / 收听记录，在指定平台建单并回读，也可点歌与控播。

- **本机 loopback**：默认 `http://127.0.0.1:38451/mcp`，Bearer 鉴权；设置里一键「复制 Agent 配置」。
- **读写分开**：默认可读；建单、喜欢、播放控制需另开「允许写入和播放控制」。
- **走 Omni**：搜索、歌词、歌单、推荐与跨平台匹配经统一入口；网易云 / QQ / Spotify / FnMusic 等可建原生歌单，`folia` / `local` 可读跨平台与本地库。
- **安全边界**：只绑本机、密钥可密封存储；关开关即停服务。密钥不要提交仓库或发到公开聊天。

## 本 Fork 的功能与修复

| 方向 | 新增内容 |
| --- | --- |
| **Hi-Fi 直通（桌面版，重点）** | 自研 WASAPI helper（与上游 mpv HiFi 不同）：独占 / 共享、整数倍优先重采样、真实链路读数、边下边放；可覆盖在线等更多音源。对照见 [Hi-Fi 直通](docs/hifi.md#与上游-mpv-hifi-的关系)。 |
| **桌面音乐 MCP（重点）** | 本机 Agent 经 `127.0.0.1:38451/mcp` 读多平台资料、建单与控播；设置里开关并复制配置。详见上方重点节与 [music-mcp.md](docs/music-mcp.md)。 |
| 桌面版 | 自己的 Windows 安装包与免安装便携版（每次推送由 GitHub Actions 构建）、自己的检测更新、桌面版当遥控端（打开服务器的遥控页）、Spotify / YouTube Music 代理设置。 |
| 服务器播放 + 多人遥控 | Host 页在服务器上出声，其他人用网址遥控；访问令牌鉴权与限流；遥控端可切回「本机播放」，账号与队列互相独立；可浏览 Host 本地曲库；Host 防后台卡顿。详见 [Stage Remote 使用文档](docs/stage-remote.md)。 |
| 多平台 | 接入 QQ 音乐、酷狗；网页版也能用 Spotify（桥在服务器上，需会员，登录在服务器上做一次）；多平台歌可混排进同一队列，切换平台不清队列；混排时播放条与队列列表标出平台；搜索按平台分标签；「+」选歌单跟随歌曲所属平台；启动默认平台按 网易云 > QQ > 酷狗 选第一个已登录的。 |
| 手机适配 | 独立的手机布局：设备自动判断（可在设置里手动指定）、底部迷你播放器与展开控制条、竖向列表的歌单 / 专辑 / 歌手页、统一避让防遮挡。电脑界面不受影响。 |
| 跨平台歌单 | 一个歌单里放任意在线平台的歌，保存在本机（每个浏览器 / 每台电脑各自一份），新建、改名、排序、播放、队列互转、导出导入；不能播的歌标出并跳过；把当前队列并进已有歌单；从已登录账号的歌单导入并保持同步最新数据；用「同步码」在多台设备间同步（歌单存在你自己的服务器上）；首页、队列面板、命令面板、底部控制条、歌曲「+」都能进。 |
| 播放体验 | 播放条显示平台实际给的音质（被降级会标出）、各平台自己的音质档位（网易云新增高清臻音 / 超清母带）、点播放改为插队、循环增加「随机」与网易云「心动模式」（仅播放「我喜欢的音乐」时出现）、清空播放队列、大歌单入队修复、播放状态自动校正、底部控制条增加「喜欢」。 |
| AI（自托管） | 自托管服务器提供 AI 主题 / 歌词分段接口，Key 仅在服务端，按网络状态自动选直连或系统代理。 |
| 运维 | `scripts\start-stage.cmd` 单窗口一键启动全部服务，重启自动清理旧进程，不误杀其他程序。 |

逐条清单、已知限制和维护约定见 [Fork 功能与修复清单](docs/fork-features.md)；Fork 有自己的版本号（当前 `FORK_VERSION`），各版本变更见 [Fork 更新日志](FORK_CHANGELOG.md)。

## 下载桌面版（Windows）

每次推送到 `stage-remote`，GitHub Actions 都会构建新的 Windows 包，发布到 [together-latest 发布页](https://github.com/AthlonHD/folia-together/releases/tag/together-latest)（始终只有最新的一份）：

| 文件 | 说明 |
| --- | --- |
| `Folia-Together-v<版本>-<提交>-Setup.exe` | 安装包 |
| `Folia-Together-v<版本>-<提交>-Portable.exe` | 免安装便携版：设置、登录、缓存都在 exe 旁的 `FoliaData` 里，整个文件夹拷走即带走全部数据 |
| 各文件的 `.sha256` | 更新时用来校验 |

- 没有数字签名，Windows 会弹 SmartScreen，点「更多信息 → 仍要运行」。
- 应用内「设置 → 通用 → 本 Fork 更新」检查并安装新版（便携版会下载新的便携文件放到旁边）。**不会**去检查上游的更新。
- 桌面版自带全套后端和本机播放，**只当遥控端、不能被遥控**：在「设置 → 播放控制 → 遥控服务器」填服务器地址和令牌，即可打开服务器的遥控页。
- 直通模式用法见 [Hi-Fi 直通](docs/hifi.md)。
- 本机 Agent 可接音乐 MCP（设置 → 连接与集成 → 音乐 MCP；默认 `http://127.0.0.1:38451/mcp`）。启用、工具与安全边界见 [桌面音乐 MCP](docs/music-mcp.md)。

## 部署与启动（服务端）

> 本 Fork 的服务端形态是**单机自托管**：一台常开的 Windows 机器同时跑前端、Stage 中继和各音乐 API。上游的 Vercel / Cloudflare 一键部署、Docker 全栈部署**不包含本 Fork 的 Stage 中继与遥控能力**，需要这些形态请到[上游仓库](https://github.com/chthollyphile/folia-major)查看；在这些形态里运行的是上游的功能集。服务端用 `start-stage.cmd --auto-update` 启动后会自己跟上本分支的新提交，与桌面版出自同一份代码。

上游桌面 Stage API 的外部播放器输入与本机连接文件不等同于 Web 遥控中继；服务器仍按本文端口和令牌配置启动，边界见 [桌面 Stage API 与 Web 中继](docs/stage-remote.md#桌面-stage-api-与-web-中继)。

### 环境要求

- Windows（启动脚本为 `.cmd`；Stage 中继本身是普通 Node 程序，也可以手动在其他系统运行）
- [Node.js](https://nodejs.org/) ≥ 24
- 网易云 API：用仓库里的（`scripts/start-netease-api.cjs`，与桌面版同一份代码和补丁），不用另装；要改用外部的 [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 目录，设置环境变量 `API_DIR`
- QQ 音乐 / 酷狗 API 的依赖由 `npm install` 一并安装，启动脚本会自动拉起它们
- Chrome（Host 页用它打开，脚本会带防后台降级参数）

### 一键启动

```bat
git clone -b stage-remote https://github.com/AthlonHD/folia-together.git
cd folia-together
npm install
scripts\start-stage.cmd
```

- 只会开**一个**黑框，五个服务的日志合在一起；关掉窗口或按 Ctrl+C 全部停止；再次运行会先自动停掉旧进程。
- 启动完成后自动用 Chrome 打开 Host 页（`/?host=1`），黑框里会打印**访问令牌**。
- 其他人遥控：打开 `http://服务器地址:3000/?token=令牌`；不带令牌打开则是「本机播放」，用自己的设备放。
- 请在服务器的**控制台桌面**（RustDesk / ToDesk）上运行，不要用 RDP，否则声音不会从服务器本机输出。

脚本参数（`--dev`、`--no-browser`、`--separate`、`--dry-run`）、端口、令牌机制、环境变量和排错见 [Stage Remote 使用文档](docs/stage-remote.md)。

### AI 功能（可选）

在仓库根目录创建 `.env.local`（已被 git 忽略，**不要提交**），按 `.env.example` 填写 `GEMINI_API_KEY`，或配置 OpenAI 兼容接口。服务器会在启动时读取，Key 只留在服务端。如果机器需要代理访问 Google，服务会在直连与系统代理之间自动选择。

### 手机使用

手机直接打开遥控地址即可，页面会自动切换为手机布局；如果被误判成电脑，到「设置 → 通用 → 界面布局」选「始终手机」，或在地址后加 `?layout=phone`。也可以用浏览器的「添加到主屏幕」安装为 PWA。

### 其他部署形态（以上游为准）

| 形态 | 说明 |
| --- | --- |
| 上游的桌面安装包（Windows / macOS / Linux / AUR / Flatpak），**不含本 Fork 的功能** | 见[上游 Releases](https://github.com/chthollyphile/folia-major/releases) 与[上游 README](https://github.com/chthollyphile/folia-major#%E8%8E%B7%E5%8F%96%E6%96%B9%E5%BC%8F) |
| Vercel / Cloudflare 一键部署 | 见[上游部署指南](https://folia-site.cielaniska.top/guide/deploy-vercel)；QQ 音乐在这些平台上的部署见 [QQ 音乐部署指南](docs/qq-music-deployment.md) |
| Docker 全栈 / Sync Server | 见 [deploy/docker](deploy/docker/README.md) 与 [sync-server](sync-server/README.md)（沿用上游的文档与镜像，不含 Stage 中继） |

## 上游的安装包

> [!NOTE]
> 以下是**上游**发布的桌面安装包，不包含本 Fork 的 Hi-Fi 直通、音乐 MCP、遥控、手机布局等功能；要本 Fork 的桌面版请用上文「下载桌面版」。
>
> - **GitHub**：[Latest Release](https://github.com/chthollyphile/folia-major/releases/latest)，提供 Windows / macOS / Linux 全平台安装包。
> - **网盘**：[夸克网盘](https://pan.quark.cn/s/6e4c6fa3bc6f) · [百度云](https://pan.baidu.com/s/1f0x3g-8PMcNCO-TJ5z1rPw?pwd=flia)（提取码 `flia`），适合国内网络，仅提供 Windows 与 Apple silicon 的正式版安装包。
>
> 更多获取方式（Web 部署、Docker、AUR、Flatpak）见[上游 README](https://github.com/chthollyphile/folia-major#%E8%8E%B7%E5%8F%96%E6%96%B9%E5%BC%8F)。

## 展示

> 以下展示来自上游的歌词动画，本 Fork 沿用。

![visualizer](./img/visualizer.png)

### 在线体验（社区版）

在浏览器里直接试用：[folia-ce.cn](https://folia-ce.cn/)

> [!NOTE]
> 这是社区部署的演示站，仅供体验，部署来源为 [folia-ce/folia-web](https://github.com/folia-ce/folia-web)。它包含社区作者自己的改动，与官方 Web 版并不完全一致；使用中遇到问题请反馈到该社区仓库。长期使用建议下载桌面版或自行部署。

### 演示视频

https://github.com/user-attachments/assets/af806cf1-f67f-4b88-b2e7-57db507e9e81

https://github.com/user-attachments/assets/fd27f4f0-64b9-4c57-8c3b-10df767f934b

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

### 部分主题预览

<table>
  <tr>
    <td width="50%">
      <img src="./img/preview-fume.png" alt="Fume 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-lumi.png" alt="Lumi 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>浮名</strong></td>
    <td align="center"><strong>流光</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cad.png" alt="Cad 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-pat.png" alt="Pat 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>心象</strong></td>
    <td align="center"><strong>云阶</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cappella.jpg" alt="群唱 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-tilt.png" alt="Tilt 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>群唱</strong></td>
    <td align="center"><strong>倾诉</strong></td>
  </tr>
    <tr>
    <td width="50%">
      <img src="./img/preview-diorama.png" alt="镜台 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-pendolo.png" alt="时计 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>镜台</strong></td>
    <td align="center"><strong>时计</strong></td>
  </tr>
</table>

不同的歌词动画具有不同的排版氛围和可调参数，让全屏歌词拥有如同文字PV般的丰富视觉效果，同时又能兼顾响应式布局，自动适配不同窗口尺寸。

## 核心能力

下表为产品整体能力。带「（上游）」的条目由上游实现，详细说明请到上游仓库查看。

| 模块 | 说明 |
| --- | --- |
| Hi-Fi 直通 | 本 Fork 重点，Windows 桌面版，见 [Hi-Fi 直通](docs/hifi.md)。 |
| 桌面音乐 MCP | 本 Fork 重点，桌面版为本机 Agent 提供音乐 API，见 [桌面音乐 MCP](docs/music-mcp.md)。 |
| 服务器播放与多人遥控 | 本 Fork 新增，见上文与 [Stage Remote 使用文档](docs/stage-remote.md)。 |
| 手机布局 | 本 Fork 新增，独立的手机外壳与页面。 |
| 多平台在线音乐 | 网易云、QQ 音乐、酷狗，搜索、歌单、收藏、混排队列（QQ / 酷狗的 Fork 侧改动见 [Fork 功能与修复清单](docs/fork-features.md)）。 |
| 在线搜索与播放 | 搜索歌曲、歌手或专辑后即可播放，并自动加载相关封面与歌词。 |
| 本地音乐支持 | 可导入本地音频文件，在本地安全保存索引信息，不上传文件内容。详细用法见 [本地音乐库管理](docs/local-library-management.md)。 |
| 智能歌词匹配 | 本地歌曲可自动匹配在线歌词与封面，也支持手动修正匹配结果。 |
| 本地歌词文件识别 | 自动加载同目录同名 `.lrc`、`.vtt`、`.ttml`、`.qrc`、`.yrc`、`.krc` 歌词文件，或歌词文件内嵌 LRC 歌词。适配 LDDC 生成的增强型逐字歌词格式。 |
| Now Playing 接入 | 支持通过本机 [Now Playing](https://github.com/Widdit/now-playing-service/) 服务接入外部播放器的歌曲、时间轴与歌词信息，并驱动 Folia 的舞台视图与全屏歌词渲染。 |
| AI 主题生成 | 基于歌曲情绪与歌词内容生成沉浸式背景与视觉参数。自托管服务器提供接口（见上文「部署与启动」）。 |
| 全屏歌词动画 | 多种歌词动画与背景，见上方展示与[上游使用指南](https://folia-site.cielaniska.top/guide/)。 |
| 多端体验 | 提供 Web 部署方式，同时支持桌面端打包分发。 |
| 模组系统 | 桌面版可通过 Folium 模组添加歌词动画、背景、播放页图层、命令、音源等；模组市场就在「设置 → 模组」里，安装、更新、卸载都在应用内完成。详见 [模组系统](#模组系统folium-2)。 |
| Sync Server | 跨设备同步外观设置与 AI 主题库，见下方 [Sync Server](#sync-server) 与 [sync-server](sync-server/README.md)。 |

## 文档

- [文档索引](docs/README.md)：本 Fork 文档与上游文档的分类入口
- [Hi-Fi 直通](docs/hifi.md) · [桌面音乐 MCP](docs/music-mcp.md) · [Fork 功能与修复清单](docs/fork-features.md) · [Stage Remote](docs/stage-remote.md)
- [技术与开发说明](docs/technical.md)：环境变量、本地开发、脚本、技术栈
- [贡献指南](CONTRIBUTING.md)：包含本 Fork 的提交与反馈约定
- 上游使用指南与站点：[Folia Guide](https://folia-site.cielaniska.top/guide/)

## 反馈与贡献

- **本 Fork 特有的功能（Hi-Fi 直通、桌面版、遥控、手机布局、QQ / 酷狗接入、启动脚本、音乐 MCP 等）与部署问题**：到本仓库提 [Issue](https://github.com/AthlonHD/folia-together/issues)。
- **上游已有的功能（歌词动画、桌面版、模组、同步服务等）**：请到[上游 Issues](https://github.com/chthollyphile/folia-major/issues) 反馈；不确定归属时，先在本仓库提即可。
- 贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。不要在 Issue、日志或截图里公开账号 Cookie、Token、API Key。
- 上游社区 Discord：[加入](https://discord.gg/dMDBTHxeKd)。Vercel / Cloudflare / 上游安装包等说明以上游 README 为准，见上文「其他部署形态」。

本 Fork 的服务端部署以上文「部署与启动」为准。上游的 Web 一键部署不含 Stage 中继：Vercel 与 Cloudflare 上的 QQ 音乐不再需要额外部署一个常驻 API 实例，把 `VITE_QQ_API_BASE` 填成 `/api/qq`，再配一个 `QQ_SESSION_SECRET`（服务端密钥，**不加 `VITE_` 前缀**）即可。这种形态支持微信扫码和手机 QQ 扫码登录（手机 QQ 扫码要 qq-music-api 3.3.3 或更高版本），且播放前必须先登录；Cloudflare 上可以再绑定一个 Durable Object，让 QQ 扫码改走长连接，并多一个 QQ 音乐 App 扫码。完整步骤见 [QQ 音乐部署指南](docs/qq-music-deployment.md)。安装包、网盘、AUR、Flatpak 与移动端见上文「上游的安装包」与「其他部署形态」。

## 模组系统（Folium 2）

> [!NOTE]
> 模组系统仅桌面版可用，Folium 2 起默认开启，但只装、只跑官方签名的音源模组；其它模组要先在「设置 → 模组」里打开「社区模组」。

Folium 是 Folia 的模组平台。模组可以添加新的歌词动画模式和背景类型、在播放页上叠加内容、给进度条加按钮和标记、注册命令与设置分区、在歌词显示前改写歌词，也可以通过 Node 入口调用 ffmpeg 等本地能力。模组以可信代码运行，每个模组在启用前都要在原生窗口中确认，文件变化后需要重新确认。

- **模组市场**：「设置 → 模组」把已安装的模组和 [模组市场](https://folium-compound.cielaniska.top) 合在一个视图里，可以按分类和关键词查找，一键安装、更新和卸载（卸载的文件夹进回收站）。也可以在网站上下载 zip，拖进模组页安装。
- **反馈问题**：模组由各自的作者维护。模组出了问题，请在模组详情里点「反馈问题」，到作者的仓库反馈，不要提交到 Folia 的仓库。
- **第三方音源与外部作品**：第三方音源模组、系统插件和外部程序不收进模组市场的仓库，以外部链接登记在 Awesome-Folia，同样能在应用里的模组市场找到。
- **版本声明过期的模组**：清单里写了 `<0.8.0` 之类上界的模组在更新的 Folia 上不会自动加载，但仍能安装，可以在模组详情里手动「仍然尝试加载」。
- **官方认证**：市场里的模组都带有 Folium 签名，安装后显示「官方认证」；只通过安全审查的先行测试模组显示「先行测试」；没有签名的第三方模组显示「未验证」，同样可以使用。
- **开发与贡献**：[模组开发与贡献指南](docs/folium/contributing.md)，从写第一个模组、本地调试，到提交到模组市场、审查与签名、发布更新。
- **API 参考**：[Folium API 参考](docs/folium/api.md)，由契约文件生成的完整接口文档，按注册表、上下文、事件、服务等分类查询。
- **平台规范**：[Folium 规范](mods/README.md)，包括清单字段、权限、注册表语义、事件、安全模型与版本策略。
- **示范模组**：仓库的 [`mods/`](mods/) 目录，覆盖歌词动画、调参、进度条、播放页图层与透明视频导出。

## Sync Server

Folia 提供了可选的官方同步服务端 `sync-server`，用于在多个设备之间同步外观设置与 AI 主题库。服务端由用户自行托管，适合希望跨设备同步配色主题的用户。

支持以下部署方式：

- **Cloudflare Workers / D1**：免服务器运维的 Serverless 部署，推荐使用。
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)
- **Docker**：镜像与 Compose 入口见 [Docker 部署目录](deploy/docker/README.md)。
- **Node.js 自托管**：使用 SQLite，适合本地或不方便使用 Docker 的环境。

详细的环境变量、Token 配置与部署步骤请参阅 [Sync-Server 部署指南](https://folia-site.cielaniska.top/guide/deploy-sync)。部署完成后，在 Folia 的「设置 → 连接与集成」中填写服务端地址和 `SYNC_TOKEN` 即可启用同步。

## 本地音乐与匹配说明

Folia 会读取音频文件元数据、同目录歌词和封面，并可通过网易云、QQ 音乐或酷狗音乐补全歌曲信息。自动匹配按网易云、QQ、酷狗依次回退；匹配不准确时，可以手动选择候选、恢复首次导入的本地信息，或进一步合并、拆分艺术家与专辑实体。

完整的导入、重扫、匹配、实体编辑、歌单、缓存和故障排查说明见 [本地音乐库管理](docs/local-library-management.md)。

## Community

加入discord社群，共同交流，获得帮助

[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)

## 贡献者

感谢所有为上游和本 Fork 提交 Issue、报告 Bug、提出想法、测试与编写代码的人。贡献者名单沿用上游的 all-contributors 记录，见 [贡献者名单](CONTRIBUTORS.md) 与[上游仓库](https://github.com/chthollyphile/folia-major)。

## 法律与免责声明

本项目在 AI 的广泛协助下开发，因此仍可能存在细微或不易察觉的问题。若给你带来不便，敬请理解。

本项目主要用于展示播放动效、界面设计与相关工程实现。应用中涉及的在线音乐流媒体、歌词、专辑封面及其他内容，其版权均归对应权利人所有。

本仓库及其源代码仅供个人学习、技术交流与非营利测试使用。请勿将其用于商业盈利用途。若因对在线资源的传播、加工或再分发而引发版权纠纷或其他责任，均由使用者自行承担，项目开发者不承担相关责任。

请始终尊重数字版权，并在条件允许时通过官方平台支持正版音乐。

本 Fork 的访问令牌机制用于小范围可信使用，**不适合直接暴露给公网陌生人**；请把服务放在可信网络或带访问控制的反向代理之后。

## 致谢

- **[chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)**：本项目的上游，提供了全部的播放、歌词与动画基础。
- 特别感谢以下项目和资源：
  - [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC)
  - [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
  - [chenglou/pretext](https://github.com/chenglou/pretext)
  - [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)
  - [paper-design/shaders](https://github.com/paper-design/shaders)
  - [yakult-green-tea/qq-music-api](https://github.com/yakult-green-tea/qq-music-api)
  - [zzyoxml/md3Music](https://github.com/zzyoxml/md3Music)
  - [rubato](https://github.com/HEnquist/rubato)（重采样）、[libsoxr](https://sourceforge.net/projects/soxr/)（SoXR 重采样）、[Symphonia](https://github.com/pdeljanov/Symphonia)（解码）：直通播放器用到的开源库

本项目接入了 [Apple Music-like Lyrics TTML 逐词歌词库](https://github.com/amll-dev/amll-ttml-db) 以提供高质量的歌词文件，感谢此歌词库的作者和贡献者们。

## 许可证

本项目基于 `AGPL-3.0` 许可证开源，Fork 部分同样遵循该许可证。
