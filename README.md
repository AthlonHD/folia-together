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

**本仓库（[AthlonHD/folia-together](https://github.com/AthlonHD/folia-together)）是它的长期维护 Fork**，开发分支为 `stage-remote`。在保留上游全部播放与歌词能力的基础上，围绕三个方向做了扩展：

- **Hi-Fi 直通（Windows 桌面版，本 Fork 的重点）**：绕开浏览器音频栈，独占时绕过 Windows 共享混音器，支持 WASAPI 独占 / 共享输出；整数采样、只做一次重采样（rubato 或 SoXR 可选）、链路显示稳态 PCM 判定和转换情况。详见下一节。
- **一台机器放歌、一群人遥控**：服务器（或常开的电脑）上的浏览器出声，朋友和家人用手机、电脑打开同一个网址点歌、切歌、管队列。
- **手机也能完整使用**：独立的手机布局，功能与电脑一致。

上游的更新会持续合并进来；**凡是与上游重复的说明（桌面版安装包、Vercel / Cloudflare 一键部署、Folium 模组系统、Sync Server、使用指南等），本仓库不再重复维护，统一链接到上游查看**。本 Fork 的部署方式与上游不同，请以本文「部署与启动」为准。

上游 mpv HiFi 与本 Fork 直通模式均保留；Windows 开启直通模式时，后续起播优先走本 Fork helper。使用 mpv 请先关闭直通模式，详见 [两套引擎的关系](docs/hifi.md#与上游-mpv-hifi-的关系)。

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

## 本 Fork 的功能与修复

| 方向 | 新增内容 |
| --- | --- |
| **Hi-Fi 直通（桌面版）** | WASAPI 独占 / 共享直出、整数采样、整数倍优先、单次重采样（rubato / SoXR 可选）、播放条显示真实链路、边下边放。详见 [Hi-Fi 直通](docs/hifi.md)。 |
| 桌面版 | 自己的 Windows 安装包与免安装便携版（每次推送由 GitHub Actions 构建）、自己的检测更新、桌面版当遥控端（打开服务器的遥控页）。 |
| 服务器播放 + 多人遥控 | Host 页在服务器上出声，其他人用网址遥控；访问令牌鉴权与限流；遥控端可切回「本机播放」，账号与队列互相独立；可浏览 Host 本地曲库；Host 防后台卡顿。详见 [Stage Remote 使用文档](docs/stage-remote.md)。 |
| 多平台 | 接入 QQ 音乐、酷狗；网页版也能用 Spotify（桥在服务器上，需会员，登录在服务器上做一次）；三个平台的歌可混排进同一队列，切换平台不清队列；搜索按平台分标签；「+」选歌单跟随歌曲所属平台；启动默认平台按 网易云 > QQ > 酷狗 选第一个已登录的。 |
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

## 部署与启动（服务端）

> 本 Fork 的服务端形态是**单机自托管**：一台常开的 Windows 机器同时跑前端、Stage 中继和各音乐 API。上游的 Vercel / Cloudflare 一键部署、Docker 全栈部署**不包含本 Fork 的 Stage 中继与遥控能力**，需要这些形态请到[上游仓库](https://github.com/chthollyphile/folia-major)查看；在这些形态里运行的是上游的功能集。服务端用 `start-stage.cmd --auto-update` 启动后会自己跟上本分支的新提交，与桌面版出自同一份代码。

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
> 以下是**上游**发布的桌面安装包，不包含本 Fork 的 Hi-Fi 直通、遥控、手机布局等功能；要本 Fork 的桌面版请用上文「下载桌面版」。
>
> - **GitHub**：[Latest Release](https://github.com/chthollyphile/folia-major/releases/latest)，提供 Windows / macOS / Linux 全平台安装包。
> - **网盘**：[夸克网盘](https://pan.quark.cn/s/6e4c6fa3bc6f) · [百度云](https://pan.baidu.com/s/1f0x3g-8PMcNCO-TJ5z1rPw?pwd=flia)（提取码 `flia`），适合国内网络，仅提供 Windows 与 Apple silicon 的正式版安装包。
>
> 更多获取方式（Web 部署、Docker、AUR、Flatpak）见[上游 README](https://github.com/chthollyphile/folia-major#%E8%8E%B7%E5%8F%96%E6%96%B9%E5%BC%8F)。

## 展示

> 以下展示来自上游的歌词动画，本 Fork 沿用。

![visualizer](./img/visualizer.png)

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
| Hi-Fi 直通 | 本 Fork 新增，Windows 桌面版，见 [Hi-Fi 直通](docs/hifi.md)。 |
| 服务器播放与多人遥控 | 本 Fork 新增，见上文与 [Stage Remote 使用文档](docs/stage-remote.md)。 |
| 多平台在线音乐 | 网易云、QQ 音乐、酷狗，搜索、歌单、收藏、混排队列（QQ / 酷狗的 Fork 侧改动见 [Fork 功能与修复清单](docs/fork-features.md)）。 |
| 手机布局 | 本 Fork 新增，独立的手机外壳与页面。 |
| 本地音乐支持 | 导入本地音频文件，在本地保存索引，不上传文件内容。见 [本地音乐库管理](docs/local-library-management.md)。 |
| 智能歌词匹配 | 本地歌曲自动匹配在线歌词与封面，也可手动修正；自动加载同目录 `.lrc` / `.vtt` / `.ttml` / `.qrc` / `.yrc` / `.krc` 等歌词文件。 |
| AI 主题生成 | 基于歌曲情绪与歌词内容生成沉浸式背景与视觉参数；自托管服务器提供接口（见上）。 |
| 全屏歌词动画（上游） | 多种歌词动画与背景，见下方展示与[上游使用指南](https://folia-site.cielaniska.top/guide/)。 |
| Now Playing 接入（上游） | 通过本机 [Now Playing](https://github.com/Widdit/now-playing-service/) 服务接入外部播放器。 |
| Folium 模组系统（上游，实验性） | 仅桌面版，见[上游文档](https://github.com/chthollyphile/folia-major#%E6%A8%A1%E7%BB%84%E7%B3%BB%E7%BB%9Ffolium-v1x)与本仓库 [`mods/`](mods/)。 |
| Sync Server（上游） | 跨设备同步外观设置与 AI 主题库，见 [sync-server](sync-server/README.md) 与[上游部署指南](https://folia-site.cielaniska.top/guide/deploy-sync)。 |

## 文档

- [文档索引](docs/README.md)：本 Fork 文档与上游文档的分类入口
- [Hi-Fi 直通](docs/hifi.md) · [Fork 功能与修复清单](docs/fork-features.md) · [Stage Remote](docs/stage-remote.md)
- [技术与开发说明](docs/technical.md)：环境变量、本地开发、脚本、技术栈
- [贡献指南](CONTRIBUTING.md)：包含本 Fork 的提交与反馈约定
- 上游使用指南与站点：[Folia Guide](https://folia-site.cielaniska.top/guide/)

## 反馈与贡献

- **本 Fork 特有的功能（Hi-Fi 直通、桌面版、遥控、手机布局、QQ / 酷狗接入、启动脚本等）与部署问题**：到本仓库提 [Issue](https://github.com/AthlonHD/folia-together/issues)。
- **上游已有的功能（歌词动画、桌面版、模组、同步服务等）**：请到[上游 Issues](https://github.com/chthollyphile/folia-major/issues) 反馈；不确定归属时，先在本仓库提即可。
- 贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。不要在 Issue、日志或截图里公开账号 Cookie、Token、API Key。

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
  - [rubato](https://github.com/HEnquist/rubato)（重采样）、[libsoxr](https://sourceforge.net/projects/soxr/)（SoXR 重采样）、[Symphonia](https://github.com/pdeljanov/Symphonia)（解码）：直通播放器用到的开源库

本项目接入了 [Apple Music-like Lyrics TTML 逐词歌词库](https://github.com/amll-dev/amll-ttml-db) 以提供高质量的歌词文件，感谢此歌词库的作者和贡献者们。

## 许可证

本项目基于 `AGPL-3.0` 许可证开源，Fork 部分同样遵循该许可证。
