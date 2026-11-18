# Hi-Fi 直通：本 Fork 的重点功能

> 桌面版（Windows）专有。网页版、遥控页和手机布局不受影响，仍走浏览器的音频栈。

直通正在准备或接管声音时，分轨调音台暂停处理并显示原因；关闭直通或回退普通播放后恢复。分轨处理只作用于浏览器音频，不修改 WASAPI helper 的输出。回归命令：`npx vitest run -c vitest.config.ts test/unit/stemMixer/stemMixerAvailability.test.ts`。尚未用真实声卡验证此组合。

浏览器和 Electron 的音频输出有两层不由应用控制的环节：Chromium 自己的音频栈，和 Windows 的共享混音器（把所有程序的声音混成一个固定格式，必要时重采样）。对想要「放出来的就是文件里的」的人，这两层都是多余的。

**直通模式**把声音交给一个独立的原生播放器 `folia-audio-helper.exe`（Rust，随安装包 / 便携版一起带），它自己解码，用 WASAPI 把采样直接送给声卡驱动，并且**如实告诉你这一路到底做了什么**。

- 设置位置：设置 → 播放控制 → 直通模式。
- 只在 Windows 桌面版出现；开不起来或遇到解不了的文件时自动回到普通播放并说明原因。
- 飞牛音乐的 `folia-fnmusic://` 音源也经主进程协议读取，交给 helper 直通；临时文件按同一套规则清理。协议白名单与暂存回归测试：`npx vitest run -c vitest.config.ts test/unit/electron/audioHelperProcess.test.ts`。尚未连接真实飞牛服务做端到端验证。
- 直通接管时，浏览器输出末端的独立增益闸门同步归零，两个播放 deck、音效及场景的 Steam Audio 房间混响都经过它；切换声卡的异步操作失败或晚到，也不会绕过这道静音。退出直通或回退普通播放时恢复。`setSinkId({ type: 'none' })` 仍用于释放浏览器输出设备。相关回归测试：`npm run test:unit -- test/unit/services/playbackGraph.test.ts test/unit/hooks/useAudioOutputDevice.test.ts`；测试验证软件静音与过期恢复保护，未替代实际声卡的录音验证。

---

> Spotify 选择上游 Soloist 备用播放方式时，由 Soloist 独立输出声音，不向本 Fork helper 提供解密流；直通仅适用于标准方式可取得的音频。Soloist 的安装与限制见 [上游实现说明](../src/services/onlineMusic/UPSTREAMS.md)。

## 与上游 mpv HiFi 的关系

上游后来也加了一套 **mpv HiFi**（设置 → 播放控制 → 播放引擎）：本地 / Navidrome 交给 mpv 子进程，按源格式开输出。本 Fork 的 **直通模式**是另一条、更早的路线——自研 `folia-audio-helper`，不经过 mpv。两套**同时保留、互不替代**；不要把它们当成同一种「Hi-Fi」。

### 差别对照

| | **本 Fork：直通（helper）** | **上游：mpv HiFi** |
| --- | --- | --- |
| 引擎 | 随包的 Rust 播放器 `folia-audio-helper.exe`，主进程用 JSON 行协议控制 | 外挂 / 下载的 **mpv** 子进程，主进程经 JSON IPC 控制 |
| 平台 | **仅 Windows** 桌面版 | Windows / macOS / Linux（Linux 不请求独占） |
| 覆盖曲目 | 能取得音频字节的来源：在线下载、本地、Navidrome、Spotify / YouTube Music 解密流、飞牛协议等 | **只**本地曲库，以及可选的 Navidrome；**在线平台歌仍走浏览器 Web Audio** |
| 输出路径 | 自己解码 → WASAPI 独占或共享，送到所选设备 | mpv 的 AO（WASAPI / Core Audio / ALSA 等）；不设固定采样率时按源格式开设备 |
| 重采样 | 应用内显式策略：跟随音源 / 固定采样率、**整数倍优先**；rubato 或 SoXR，有可复现的升采样误差数据 | 交 mpv；格式变化时由 mpv 重开输出（`gapless-audio=weak`），本 Fork 不另做 SoXR/rubato 对照表 |
| 链路读数 | 播放条 `PassthroughChainBadge`：采样率/位深、独占或共享、是否「稳态 PCM 未改动」、用了哪种重采样 | 信号链路面板：源 → 解复用 → 解码 → 处理 → 输出逐级比对；Linux 还可探 PipeWire |
| 时钟 | `<audio>` 静音跑当作传输时钟，以 helper 位置为准纠偏 | mpv 约 4 Hz 推位置，渲染端外推；另有 media shim 给系统媒体控制等 |
| 无缝 / 预载 | 边下边放（GrowingFile）；切歌即停旧歌 | mpv `loadfile append` 预载下一首 |
| 设置入口 | 「直通模式」一组（设备、独占/共享、重采样、采样率策略） | 「播放引擎」选 mpv 后出现输出 / DSD 等项；与直通是两套开关 |
| 代码位置 | `packaging/windows/audio-helper/`、`electron/audioHelper/`、`src/components/app/passthrough/` | `electron/hifi/`、`src/services/hifi/`、`src/components/hifi/` |

一句话：**mpv HiFi 解决「本地（和 Navidrome）别走浏览器音频」；本 Fork 直通解决「Windows 上尽量多音源走自研 WASAPI 链路，并标明这一路做了什么」。**

### 同时开着时谁优先

- Windows 上若打开了本 Fork **直通模式**，**后续起播优先走 helper**（含本来可以交给 mpv 的本地 / Navidrome）。
- 正在由 mpv 播放的那一首会继续用 mpv，直到切歌；切歌后再按当前设置选路线。
- mpv 在播时 helper 停止，不再同步浏览器时钟。
- **要用上游 mpv：请先关闭本 Fork 直通模式**，再在「播放引擎」里选 mpv。
- 非 Windows、或未开直通时，本地 / Navidrome 仍可按上游逻辑走 mpv。

上游引擎的能力、错误码与 Linux 细节见 [mpv HiFi 说明](../src/services/hifi/README.md)。两边都没有做「helper vs mpv 输出录回」对照；现有正弦升采样数据不能证明哪边听感更好。

## 它做到了什么

| | |
| --- | --- |
| **WASAPI 独占** | 绕过 Windows 混音器，设备接受什么格式就原样给什么格式，不经过系统重采样、不与其他程序混音 |
| **WASAPI 共享** | 给不接受独占流的驱动用（如虚拟声卡 WDM2VST）：按设备当前的混音格式输出，本程序做**一次**重采样 |
| **整数 PCM 优先** | 解码结果转为 32 位左对齐整数；整数 PCM 在不重采样时优先原样输出。重采样、有损或浮点源、浮点输出回退不能概括成「完全不走浮点」 |
| **采样率策略** | 「跟随音源」先按歌曲自己的采样率打开设备，设备不接受才改用它支持的最接近的采样率，**整数倍优先**（44.1k→88.2k/176.4k、48k→96k/192k）；「固定」始终用你设的采样率（如 192 kHz） |
| **应用内单级重采样** | 需要时由 helper 做一次重采样；不保证 Windows 共享混音器、驱动或设备内部没有后续处理。重采样器初始化失败时终止原生播放并回落，不能把原速率样本直接送给不同速率的设备 |
| **两种重采样器** | rubato（默认）或 SoXR（libsoxr）可选，见下 |
| **如实的链路读数** | 只有已知整数位深、双声道、独占、采样率一致且未降位时标为「稳态 PCM 未改动」。共享、未知位深、浮点源或声道转换不作这个承诺；前端也会重新核对旧 helper 的标记 |
| **声道边界** | 单声道复制为左右两路并标明布局转换；超过双声道明确回落普通播放，不再直接丢弃其他声道 |
| **边下边放，切歌即停** | 需要下载的歌下到前 512 KB 就开始出声，其余边下边放；点切歌的当下旧歌立刻停 |
| **无爆音** | 暂停、恢复、跳转、中断处有几毫秒的淡入淡出，其余时间采样值原样输出 |
| **可取得音频的来源** | 在线歌曲、本地文件、Navidrome，以及 Spotify / YouTube Music 解密后的流（存成 `eph-` 临时文件，下一首即删，不当缓存）；Apple Music 由独立伴随播放器输出，不交给 helper |

## 播放条上的链路读数

直通模式下，播放条的音质徽章旁边多一个徽章，例如：

```
● 44.1k/16→192k/24 · 共享 · 已重采样 SoXR
● 96k/24→96k/24 · 独占 · 稳态 PCM 未改动
```

- **绿点**：稳态 PCM 未改动，判定条件见上表。**琥珀点**：已知有转换、经过共享混音器，或无法确认 PCM 一致性；不等于一定能听出差异。重采样时写明算法。
- 这个结论只覆盖 helper 的稳态处理到驱动前：暂停、恢复和缓冲中断附近的防爆音渐变会改动采样，不承诺整首逐样本一致。WASAPI 独占绕过 Windows 共享混音器，仍依赖 Windows 接口与驱动，不是绕过整个 Windows。
- 数字取自播放器报告的实际输出格式（采样率 / 有效位深）。
- 悬停可看到完整写法：编码、源格式 → 输出格式、设备名、独占或共享。
- 设置页的「当前链路」是同一份数据的完整写法，另外显示当前输出电平（dBFS，取一小段时间内送给设备的最大采样）；电平每 0.1 秒左右变一次，所以不放在悬停提示里（放进去会让气泡不停重置）。
- 左侧的音质徽章（`Hi-Res · FLAC`）仍是**平台实际给的**音质，二者合起来就是「平台给了什么 → 我们送出去什么」。

## 重采样

只在设备不接受歌曲原采样率时才用；能原样输出的歌不经过它。

| | rubato（默认） | SoXR |
| --- | --- | --- |
| 实现 | rubato 5 的 FFT 同步重采样器，f64 运算，8192 帧长滤波器（BlackmanHarris2 窗） | libsoxr 的 32 位精度档，线性相位，64 位运算，系数按比例的每个相位精确计算 |
| 输入输出 | 32 位整数 ↔ f64 | 32 位整数直接进出，不加抖动 |
| 来源 | 开源库（MIT） | SoX 的重采样器，音响圈最常被拿来比较的那个（LGPL-2.1，源码在 `packaging/windows/audio-helper/vendor/soxr`，静态链接） |

**实测**（`cargo test --release -- --nocapture` 可重现，代码在 `packaging/windows/audio-helper/src/resample.rs`）：用纯音升采样，与理想信号相比，误差在两个算法上都压到 32 位整数取整的底噪，约 **−194 dBFS**：

| 转换 | 测试音 | rubato | SoXR |
| --- | --- | --- | --- |
| 48k → 192k | 1 k / 10 k / 18 k / 20 kHz | −195 … −194 dBFS | −195 … −194 dBFS |
| 44.1k → 96k | 1 k / 10 k / 18 k / 20 kHz | −194 dBFS | −194 dBFS |
| 44.1k → 192k | 1 k / 10 k / 18 k / 20 kHz | −195 … −194 dBFS | −195 … −194 dBFS |

作为参照，24 位的量化底噪是 −144 dBFS：这个误差比它低将近 50 dB，已经远在任何 DAC 能体现的范围之外。原来的采样点在输出里保留，输出长度恰好等于理论长度，不多不少。

**这个结论的边界**：测试只覆盖升采样、单频正弦、22 kHz 以内；降采样时必须滤掉新奈奎斯特频率以上的内容，有过渡带，这部分没有同样的数据。所以：能不转就不转（链路上有「跟随音源」与整数倍优先），转的话在整数比上最干净。

- **选哪个**：听感上没有差别；默认 rubato。SoXR 主要给习惯用它做对照的人。切换后从下一首歌生效。
- **为什么不是「最好」**：带限重采样是取舍（过渡带宽度、阻带衰减、相位、速度），没有在所有指标上都最优的设置；主流高质量算法的伪影都远低于量化底噪。想看各算法的公开横评：[Sample Rate Conversion Comparison（HydrogenAudio）](https://src.hydrogenaudio.org/technical)、[Infinite Wave SRC 对比](https://src.infinitewave.ca)，理论基础见 [Julius O. Smith 的重采样教程](https://ccrma.stanford.edu/~jos/resample)。这两个算法没有放进那些公开榜单里测过，上面的数据是本仓库自己的测试。
- **位深**：只在设备给不了源的位深时才降位，四舍五入，不截断；**不加抖动**，且会在链路读数里标出「位深被截断」。

## 独占与共享怎么选

- **普通声卡 / USB DAC**：用**独占**。设备接受什么就给什么，「检测设备能力」会列出它在独占下接受的采样率与位深，那就是它的上限。
- **只通过共享流的虚拟声卡**（如 WDM2VST、部分虚拟线缆）：用**共享**。这类驱动会忽略独占流，独占模式下设备「打开成功」却没有声音。共享下声音按设备的混音格式输出（在 Windows 声音设置里把它设成你要的最高格式，如 192 kHz / 24 bit）。
- 独占时 Windows 系统音量和播放器自己的音量条都不起作用，声音以满幅度送出，**音量请在 DAC / 耳放上调**，第一次先压低。
- 独占时别的程序（系统提示音等）用不了这个设备；关掉直通或切回共享即恢复。

## 能保证什么，不能保证什么

**能**：对已知整数 PCM，在符合上表条件的稳态区间保留采样值；需要重采样时，helper 内只做单级转换。链路标记是代码与格式报告的判定，不是 DAC 端的逐样本测量。

**不能**：
- **「设备接受」不等于「设备内部不转换」**：例如 VB-Cable 接受 96 kHz 独占，但内部按 48 kHz 运行并且只保留约 19 位精度；WDM2VST 在驱动和 DAW 的时钟之间还会再做一次插值重采样。端到端是否逐位一致，取决于下游，只有在另一端录下来与原文件逐样本比对才能确认。
- **有损源不会因此变无损**：MP3、Ogg、AAC 解码成整数送出，Spotify 最高 320 kbit/s Ogg Vorbis 仍是 320 kbit/s Ogg Vorbis。
- **没有数字音量**：独占下不提供软件音量（做数字衰减就要加抖动，否则损失位深），音量交给下游硬件。
- **没做盲听对比**：「听不出差别」是根据误差远低于量化底噪推断的，不是听力实验的结论。
- **没有与 mpv 做输出录回对照**：现有正弦升采样测试不能证明 helper 比 mpv 音质更好，也不能代表所有频率、降采样或实际音乐。
- **双路播放架构仍在**：浏览器元素继续静音运行并与 helper 对时；这次修正了切歌时的纠偏状态、移除音源后的停止以及失败时的退出，没有改造成完全由 helper 负责的独立播放时钟。
- **验证范围**：链路在 VB-Cable（共享与独占）上验证过；真实 USB DAC 和你的 DAC 品牌没有逐一测过——接上后用「检测设备能力」看它支持什么，再放一首 44.1k 和一首 96k 的歌，看链路读数。

## 设置项

| 设置 | 说明 |
| --- | --- |
| 直通模式 | 开关 |
| 输出设备 | WASAPI 输出端点；空为系统默认 |
| 输出方式 | 独占 / 共享（设备格式） |
| 重采样算法 | rubato（默认）/ SoXR |
| 输出采样率 | 跟随音源 / 固定（44.1k … 384k），仅独占 |
| 检测设备能力 | 列出该设备在独占模式下接受的格式 |
| 当前链路 | 当前这首歌实际的链路与输出电平 |

开启后不生效的：均衡器、音效、混音过渡（automix）、音量滑块、ReplayGain、淡入淡出、「当前播放声卡」（声音由直通播放器输出，相关项在设置里置灰并说明）。

## 构建与代码位置

- **构建**：`npm run build:audio-helper`（需要 Rust 与 MSVC 生成工具）把 `packaging/windows/audio-helper/` 编成 `build/folia-audio-helper.exe`；`npm run build:electron` 自动带上并打进 `resources/`。开发时可用环境变量 `FOLIA_AUDIO_HELPER_PATH` 指定路径。libsoxr 的 C 源码随仓库提供（`vendor/soxr`），用 `cc` 编译，不需要 CMake。
- **helper 命令行**：`folia-audio-helper devices`、`folia-audio-helper probe <设备ID>`，`capture` 是开发自检用的录音命令；与主进程之间是按行的 JSON 协议（`protocol.rs`）。
- **代码位置**：`packaging/windows/audio-helper/`（Rust：解码、重采样、WASAPI、边下边放的 `GrowingFile`）、`electron/audioHelper/`（主进程：取源、下载、helper 进程管理）、`src/components/app/passthrough/`（页面 hook：用 `<audio>` 当静音的传输时钟，以 helper 的位置为准，漂移超过 0.3 秒就拉回）、`src/services/passthrough/`（类型、链路格式化、状态）、`src/stores/usePassthroughSettingsStore.ts`（设置，存储键 `passthrough_*`）、`src/components/shared/PassthroughChainBadge.tsx`（播放条读数）。
- **在没有仓库的电脑上一键试用**：`scripts/start-passthrough.ps1`（缺什么装什么、自动 clone、编译 helper、列设备、启动），一行命令见 [Fork 功能清单](fork-features.md#8-桌面版直通模式windows)。
- **日常使用不用自己编译**：每次推送都会在 GitHub 的 `together-latest` 发布页生成安装包和免安装的便携版，见 [Fork 功能清单](fork-features.md#10-安装包自动发布)。
