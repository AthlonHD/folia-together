# Fork 功能与修复清单

本仓库（[AthlonHD/folia-together](https://github.com/AthlonHD/folia-together)）是 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 的长期维护 Fork，开发分支为 `stage-remote`。这份文档记录相对上游**多出来的**所有功能与修复，按主题归类；每次合并上游后会保持同步。

- 上游的功能说明、使用指南与许可证条款不变，见根目录 [README](../README.md)。
- 与上游重叠的部分，原则是「不改上游行为，只加不替换」：新增能力放在独立模块或受开关控制，上游新版本通过合并（merge）引入，冲突在本 Fork 内解决。
- 当前已合并上游 main 至 `f3a90708`（版本号仍是 **v0.7.21**；新近并入的有 Folium 1.7：模组命令可绑系统级全局快捷键、密钥字段、`folium.account`、实验接口 `platform.raw` 等；含 Spotify / YouTube Music 接入、统一登录窗口、探索页、智能动感模式、设置页重做与 `src/` 目录整理、qq-music-api 3.3.x 等）。每次合并后这里会更新；合并带来依赖升级时需要重新执行 `npm install`。与本 Fork 的交叉点：上游新增的 `handleSetLoopMode`（模组用）会同时关掉随机与心动；上游的「平台换了清空播放器」在本 Fork 里由账户端口声明 `holdsSongs: () => false` 关掉，切换平台仍不清队列。

**重点功能：[Hi-Fi 直通（桌面版）](hifi.md)**——WASAPI 独占 / 共享直出、整数采样、整数倍优先、单次重采样（rubato / SoXR）、真实链路读数。完整说明、实测数据与边界在 [hifi.md](hifi.md)，本文第 8 节只保留与其他功能交叉的部分、构建与脚本。

---

## 1. 服务器本机播放与多人遥控

详见 [Stage Remote 使用文档](stage-remote.md)。

- **多人遥控**：一台机器当 Host 出声，其他人用网址遥控；Stage 中继（`server/stage-relay`）复用桌面版 Stage API 的路由与状态逻辑，Electron IPC 换成 Host 页的 WebSocket。
- **访问令牌**：只有带 `?token=` 的地址默认进入遥控；手动切换遥控需填令牌；中继校验所有遥控、曲库、WebSocket 与共享账号代理请求并限流。
- **本机播放 / 遥控 双模式**：遥控端可随时切回本机播放，账号、队列、曲库与遥控模式互相独立，外观设置共用。
- **Host 设置为准**：播放相关设置以 Host 为准，遥控端隐藏只能在 Host 上设置的项；音质增加降级兜底；搜索支持滚动加载。
- **Host 本地曲库**：遥控端浏览并播放 Host 已关联的本地音乐。
- **Host 防卡顿**：Host 页失焦时停止渲染画面，启动脚本给 Chrome 加防后台降级参数，解决窗口在后台时音乐每秒卡顿。
- **「播放位置」设置入口**：加入设置左侧目录（仅在配置了中继且非 Host 页时列出）。

## 2. 多平台在线音乐（网易云 / QQ 音乐 / 酷狗 / Spotify 网页版）

- **QQ 音乐接入**：后端启动脚本、`/qq` 中继代理、Host 账号共享、遥控协议放行。
- **酷狗接入**：同上，`/kugou`。
- **跨平台混排队列**：三个平台的歌可进同一个队列；切换平台不再清空播放与队列、不再弹确认框。
- **「+」选歌单跟随歌曲所属平台**：在 QQ 歌曲上点「+」列出 QQ 的歌单，而不是网易云的；不支持的给出明确提示。
- **搜索多平台标签**：按每个可用的在线平台各给一个搜索标签，不再只有当前平台。
- **Spotify 网页版**：上游的 Spotify 只有桌面版；本 Fork 把桌面版的 Spotify 桥（API、登录、librespot 解密播放）搬进 Stage 中继（`server/stage-relay/spotify.cjs`）。Host 页与遥控页共用服务器上的一个账号（只有 Host 页能登录 / 登出）；本机播放的页面有自己的一份账号（浏览器里的随机标识，服务器按它封存），登录时授权后的网址要粘贴回来。需要 Spotify 会员。详见 [Stage Remote 使用文档](stage-remote.md#spotify网页版)。
- **启动默认平台按优先级**：网易云 > QQ 音乐 > 酷狗，选第一个已登录的；不被网易云启动瞬间的未登录状态带偏，等状态稳定后再选，并支持之后升回更高优先级；恢复会话不再把平台改成上次那首歌的平台。

## 3. 播放与队列

- **点播放改为插队到当前位置**，不再替换整个队列。
- **播放条固定「加入播放队列」按钮**。
- **循环按钮增加「随机」一档**，遥控模式同步。
- **清空播放队列**：队列面板新增按钮。
- **大歌单入队修复**：批量取歌曲详情，避免超时导致只进一首。
- **播放状态校正**：播放元素确实在出声却显示暂停时，自动校正为播放中；切歌后自动播放意图迟迟没兑现时主动开始播放（兜住歌词慢导致的卡住）。
- **心动模式(网易云)**:循环按钮在「关闭 → 列表循环 → 单曲循环 → 随机」之后多一档「心动」(心形加心跳线图标),**只在从网易云「我喜欢的音乐」歌单页播放、且当前这首正是该歌单里的歌时出现**（点歌单里的歌是插队进现有队列，所以不要求队列里全是它的歌）。开启后按当前歌与「我喜欢的音乐」向网易云的 `/playmode/intelligence/list` 要推荐,把第一首不在队列里的歌插到当前歌后面播放;**不是每次切歌都推荐**——默认「1 首歌单 : 1 首推荐」交替,可在「设置 → 播放控制 → 播放行为」里改成 每首都推荐 / 2:1 / 3:1,推荐歌播完一定回到歌单里的下一首;接口失败则退回队列顺序。切到不属于该歌单的歌(搜索、别的歌单)后该档消失;心动不落盘,重启后回到列表循环。遥控端同步显示与切换。
- **实际音质显示**:播放条标题下显示平台**实际给的**音质(如 `Hi-Res · FLAC`、`Ogg Vorbis · 320k`);比「设置」里选的低时带 ↓ 并用琥珀色,悬停可见所选与实际。数据来自平台自己的响应:网易云(level / br / type)、Spotify(文件格式)、YouTube Music(itag / 码率);平台不说、或从媒体缓存里放出的旧副本不显示(不拿请求的档位冒充)。Spotify 本身只有 160 / 320 kbit/s,选 hires 会显示降级。手机布局同样显示。
- **各平台自己的音质档位**:音质下拉只列当前平台真有的档,并标实际规格。网易云 标准 128k / 极高 320k / 无损 FLAC / Hi-Res / **高清臻音 / 超清母带**(新增两档,拿不到时按 母带→臻音→Hi-Res→无损→极高→标准 逐档降;杜比全景声、沉浸环绕声是多声道格式,浏览器放不了,不列);QQ 标准 128k / 极高 320k / 无损 FLAC(后端没有 Hi-Res);酷狗 128k / 320k / FLAC / 高解析;Spotify 160 / 320 kbit/s;YouTube Music 标准 / 极高 /(会员)超高。偏好仍是一个全局值,平台没有的档自动落到它最接近且不高于的那一档。
- **底部控制条槽位**：右侧原来的「歌词时间轴」默认位换成「喜欢」（加入「我喜欢的音乐」），旧默认自动迁移，仍可在设置里改回。

## 4. 手机适配（独立的手机布局）

手机与电脑是两套独立布局，电脑界面保持原样。

- **设备判断**（`src/services/deviceProfile.ts`）：按触屏主指针与设备短边（< 600px）判断，并以手机 UA + 触点作补充证据；拿不准按电脑。网址 `?layout=phone|desktop` 优先，设置里「界面布局」可选 自动 / 始终手机 / 始终电脑，立即生效。`<html>` 带 `data-layout` / `data-orientation`，并提供安全区变量 `--safe-*`。
- **手机外壳**（`src/components/phone/PhoneChrome.tsx`）：底部迷你播放器 / 展开控制条、播放页返回键、面板开关；所有底部浮动元素按统一基线避让，解决元素遮挡；横屏用紧凑布局。
- **手机资料库 suite**（`src/library/suites/phone`）：集合页 / 专辑页 / 歌手页改成竖向列表——点整行播放、「+」入队、筛选、继续加载，以及收藏、改名、删除、移除条目、打开专辑与歌手（底部操作面板）。手机布局下自动生效，不出现在选项里，也不改写你为电脑选的资料库界面；首页与账户页沿用 Grid。
- 已知限制：手机上的动画与滚动流畅度与电脑有差距（毛玻璃、全屏可视化器、长列表的开销）；播放页歌词按可视化器的竖屏排版、横屏适配仍在完善。

## 5. AI 主题与歌词（自托管服务器）

- 自托管的 dev / preview 服务器提供 AI 接口（主题生成、歌词分段），读取 `.env.local` 里的 `GEMINI_API_KEY` 等 Key（见 `.env.example`），并带全局限流；Key 只在服务端，不进浏览器。
- **访问路径自适应**：按当下网络状态选择 直连 / 系统代理 / 都不通时立即报错，不再依赖写死的代理开关（适配「有时开 TUN、有时开系统代理、有时都不开」）。

## 6. 资料库与搜索

- **搜索来源顺序**（设置 → 主页与歌单 → 搜索）：搜索页上各来源标签（各个在线平台、本地、Navidrome）的先后顺序可以自己排，拖动或聚焦后用方向键调整，可恢复默认；「当前平台排第一」默认开（和原来一样，正在用的平台总是第一个标签，其余按你排的顺序），关掉则完全按你排的顺序。新增的平台（如模组加的）排在已有的后面。存储键 `search_source_order`、`search_current_first`；代码 `src/utils/searchSourceOrder.ts`、`src/stores/useSearchSettingsStore.ts`、`src/components/app/search/useSearchSources.ts`。
- 搜索：Bravais 首页提交搜索后自动发起（首次搜索不再为空）；歌手 / 专辑页下方的搜索页不再透出。
- 本地歌单曾尝试「清空歌单」后已按需求撤回，当前只提供「清空播放队列」。

## 6.5 跨平台歌单

一个歌单里可以放网易云、QQ 音乐、酷狗、Spotify、YouTube Music 等**任意在线平台**的歌，保存在**这台设备**上（浏览器的 IndexedDB 或桌面版自己的存储）；每个浏览器、每台电脑各自一份，互不同步。遥控页没有自己的（和账号、队列一样用 Host 的）。

- **入口**（到处都能打开同一个窗口）：①首页——网格资料库的页签行里一个图标（悬停展开「跨平台歌单」，和旁边的队列拼贴一样）；Bravais 的首页「⋯」菜单里；②播放队列面板标题栏的图标（队列为空时是中间的按钮），以及底部控制条的队列按钮打开的队列列表（命令面板）右上角的「存入跨平台歌单」（有筛选词时只存匹配的歌）；③命令面板（Ctrl+K，搜「歌单」或「跨平台歌单」）；④设置 → 播放页 → 进度条两侧槽位里可以选「跨平台歌单」，放到底部控制条上（默认不放）；⑤任意在线歌曲的「+」选歌单里，平台自己的歌单下面多了跨平台歌单和「新建跨平台歌单…」（Spotify 这类不能往平台歌单加歌的平台，只剩跨平台歌单这一项，因此也能收藏）。TUI 资料库界面没有专门入口，用命令面板。遥控页没有（见上）。
- **功能**：新建、重命名、删除、加歌、移除、上下移动、播放全部、加入队列、点某首从它开始播（队列是歌单里能播的歌）、导出和导入文件（JSON，按歌单 id 合并，后改的覆盖先改的）。
- **把当前播放队列放进歌单**：「把当前队列存为歌单」新建一个；或「把当前队列加入已有歌单」（歌单窗口列表页）/「加入当前队列」（某个歌单里）合进已有的。队列里歌单已经有的歌自动跳过并告诉你「加入了几首、几首已在歌单里或不能加入」，只收在线歌曲，同一首歌不会重复。
- **从账号歌单导入并保持同步**：歌单窗口的「从账号导入」列出你已登录的各平台账号里的歌单（网易云、QQ、酷狗、Spotify、YouTube Music 等），可多选，放进**一个已有的跨平台歌单**或**每个各建一个同名的新歌单**；勾上「保持同步」后，这个歌单会记住它来自哪些平台歌单，之后点「刷新」（或打开歌单时超过 10 分钟没读过会自动读一次）就把平台歌单新增的歌加到末尾、拿掉平台歌单已经删掉的歌。你**手动加的歌不会被拿掉**，你**手动删掉的歌不会被带回来**；同一首歌来自多个平台歌单时，要等它们都删了才拿掉；「不再同步」保留已有的歌。关联信息（来自哪个平台歌单、上次刷新时间、不要带回的歌）和歌单一起存、一起经同步码同步到其他设备；刷新读的是这台设备上登录的账号，所以那台设备没登录对应平台时刷新会失败（歌单里已有的歌照常）。
- **只收在线平台的歌**：本地文件和 Navidrome 的歌放到别的设备上没有意义，不能加入。同一首歌（同一平台同一 id）在一个歌单里只放一次；不同平台的同名歌算两首。
- **不可播放的歌**：歌单里每首歌连同保存时的信息一起存下来，显示不用先问平台；平台说这首现在不能播（下架、需会员）的会标出「暂不可播放」，播放全部、加入队列时自动跳过并提示，不会自动换成别的平台的版本。
- **会不会丢**：只清「缓存」不会丢，清「Cookie 和其他网站数据」、隐私模式、换浏览器会丢。第一次写入时会向浏览器申请「持久存储」（不被磁盘紧张时自动回收），所以仍建议定期**导出**备份。
- **同步（同步码）**：像输入法同步那样，一台设备「同步」→「生成同步码」，另一台设备输入，两边就关联起来，此后互相同步，换设备或清了浏览器数据也能找回。歌单存在你自己的 Folia 服务器上（`~/.folia-stage/sync`，明文，请只在可信网络用），接口 `/stage/sync/*` 凭组密钥访问、不需要访问令牌。改动停下 1.5 秒后自动上传；页面启动、窗口打开时每分钟、页面回到前台时拉取。按歌单整份合并，修改时间较晚的为准；删除只做标记，旧副本带不回来；设备离线时改动留在本机，联网后再同步；新加入的设备本机已有的歌单与同步组里的取并集，不丢任何一边。每个歌单、每个条目都有自己的 id，歌单记录最后修改时间。网页版用页面自己的地址，桌面版在同步窗口里填服务器地址（填过「遥控服务器」会自动带出）。没连到服务器的页面（如 Vercel 部署）没有同步，只有本机歌单加导出导入。服务端细节见 [Stage Remote 使用文档](stage-remote.md#跨平台歌单同步)。
- **代码**：`src/components/app/crossPlaylist/`（`crossPlaylistModel.ts` 纯数据与合并、`crossPlaylistStore.ts` 存储与同步状态、`crossPlaylistSyncClient.ts` 同步客户端、`CrossPlaylistHost.tsx` 窗口、`CrossPlaylistSyncDialog.tsx` 同步窗口）、`server/stage-relay/playlistSync.cjs`（服务端），接入点在 `App.tsx`、`AddToPlaylistHost.tsx`、`QueueTab.tsx`；存储键 `cross_playlists_v1`。

---

## 7. 运维脚本

| 脚本 | 说明 |
| --- | --- |
| `scripts/start-stage.cmd` | 一键启动全部服务（默认**单窗口**、日志带前缀、关窗口全停、启动前先停旧的）并打开 Host 页；`--dev` / `--no-browser` / `--separate` / `--dry-run` |
| `scripts/stop-stage.cmd` | 停止服务；只结束监听这些端口的 **node** 进程，不误杀桌面 QQ 等 |
| `scripts/stage-all.cjs` | 单窗口多服务的实际执行体 |
| `scripts/start-qq-api.cjs` / `start-kugou-api.cjs` | QQ / 酷狗后端启动 |
| `npm run stage:relay` / `stage:serve` / `stage:start` / `stage:stop` | 对应的 npm 入口 |

## 8. 桌面版直通模式（Windows）

> 完整说明见 **[Hi-Fi 直通](hifi.md)**。下面是这个功能的要点、与其他功能的交叉和构建细节。

桌面版新增「直通模式」（设置 → 播放控制 → 直通模式）：曲目的声音不再走浏览器的音频栈（共享 WASAPI、系统混音器），而是交给独立的原生播放器 `folia-audio-helper.exe`，用 **WASAPI 独占模式**直接送到所选输出设备。网页版、遥控页、手机布局完全不受影响。

- **链路**：主进程把歌曲取成本机文件（在线 URL 由主进程下载，blob 由页面读出字节）→ helper 用 Symphonia 解码成整数采样 → 设备接受的格式原样输出（16 / 24 / 32 位）。`<audio>` 元素继续在页面里静音运行，当作歌词、队列、可视化读取的传输时钟；以 helper 的位置为准，漂移超过 0.3 秒就把元素拉回。
- **采样率策略**：「跟随音源」先按音源采样率打开设备，设备不接受才改用它支持的最接近的速率（整数倍优先）；「固定」始终用设置的采样率（如 192 kHz），音源不同时由本程序做**一次**高质量重采样，不让设备或系统去转。
- **重采样算法可选**：rubato（默认）或 SoXR（libsoxr，线性相位、32 位精度档、64 位运算；源码在 `packaging/windows/audio-helper/vendor/soxr`，LGPL-2.1，静态链接；helper 自身为 AGPL-3.0）。两者在测试音上的升采样误差都在 −194 dBFS 左右的取整底噪，对比表见 [hifi.md](hifi.md#重采样)。改动从下一首生效。
- **播放条链路读数**：音质徽章旁的 `PassthroughChainBadge`，显示播放器报告的真实输出（采样率 / 位深、独占或共享、逐位一致或做了什么、重采样用的算法），绿点逐位一致、琥珀点有改动；悬停提示不含会变的输出电平（电平只在设置页），否则原生气泡会一闪一闪。
- **边下边放、切歌即停**：需要下载的歌下到前 512 KB（`HEAD_START_BYTES`）就交给播放器，其余写进 `.part` 文件，播放器的 `GrowingFile` 读这个正在增长的文件、等没到的数据；识别格式时先把文件末尾当作零（跳过结尾的标签），识别不了的（如索引在文件末尾的 MP4）再等下载完。点切歌的当下页面先让旧歌停；被新一次载入替换的下载立刻放弃。代码：`electron/audioHelper/stageSource.cjs` 的 `beginStage`、`source.rs` 的 `GrowingFile`。
- **重采样质量**：用 rubato 的 FFT 重采样器（f64 内部精度、8192 帧长滤波器），带内平坦到距音源奈奎斯特频率约 100 Hz 以内；实测 48 kHz→192 kHz 时 100 Hz–22 kHz 的纯音与理想信号的误差都在 -190 dBFS 以下（24 位底噪为 -144 dBFS），原来的采样点在输出里原样保留。更短的滤波器会削掉接近奈奎斯特的最高一小段（44.1 kHz 音源的 20 kHz 以上），所以不用。`cargo test --release -- --nocapture` 可重现这组数据。
- **只做无损的位深转换**：16 位补零进 24 位、24 位原样；需要丢位时四舍五入，不截断。位深和声道数一旦被改动，会在链路状态里标出（已重采样 / 位深被截断 / 声道被混合），只有三项都不是才显示「逐位一致」。
- **暂停、恢复、中断后有几毫秒的淡入淡出**避免爆音，其余时间采样值原样输出。
- **开启后不生效的**：均衡器、音效、混音过渡（automix）、音量滑块、ReplayGain、淡入淡出、「当前播放声卡」（设置里置灰并说明；音量请在下游调节）。所有来源都走直通：在线歌曲（http 地址由主进程下载）、本地文件和已缓存的歌（页面读出字节）、Navidrome 流，以及应用自己的音频地址（Spotify、YouTube Music 的解密流、转码后的文件，由主进程的 `net.fetch` 取成临时文件）。应用自己的音频地址取得的是解密 / 转码后的内容，只存成 `eph-` 临时文件，下一首开始、应用启动和退出时都会删除，不当缓存留着。helper 解不了的格式或取不到文件时自动回到普通播放并提示原因。Spotify 本身最高 320 kbit/s Ogg Vorbis，直通不会让它变成无损。
- **设备能力探测**：设置里的「检测设备能力」列出该设备在独占模式下接受的格式。**注意**：设备「接受」某个格式不等于它内部不转换——例如 VB-Cable 接受 96 kHz 独占，但内部按 48 kHz 运行并且只保留约 19 位精度。要确认你的虚拟声卡或 DAW 输入（如 Studio One 的 WDM2VST）是否透明，需要在它的另一端录下来与原文件逐样本比对。
- **一键脚本**（`scripts/start-passthrough.ps1`，从零开始）：没有仓库的电脑上把下面这一行粘进 PowerShell 或 cmd 即可——缺 Git / Node 24 / Rust / Visual Studio Build Tools 就自动下载安装（安装包校验数字签名或官方 SHA-256，装 Build Tools 会弹一次 UAC），自动 clone 本仓库 `stage-remote` 到 `%USERPROFILE%olia-together`，再装依赖、下载 Electron、编译 helper、列出输出设备、启动桌面版。

  ```
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/AthlonHD/folia-together/stage-remote/scripts/start-passthrough.ps1 | iex"
  ```

  已有仓库时也可直接 `scripts\start-passthrough.cmd`（会先 `git fetch` 并快进更新）；参数 `-BuildOnly` 只装工具、编译并列设备，`-NoStart` 不启动应用。
- **构建**：`npm run build:audio-helper`（需要 Rust 和 MSVC 生成工具）把 `packaging/windows/audio-helper/` 编成 `build/folia-audio-helper.exe`，`npm run build:electron` 会自动带上并打进安装包的 `resources/`；开发时也可用环境变量 `FOLIA_AUDIO_HELPER_PATH` 指定路径。helper 另有两个命令行：`folia-audio-helper devices`、`folia-audio-helper probe <设备ID>`；`capture` 是开发自检用的录音命令。
- **代码位置**：`packaging/windows/audio-helper/`（Rust）、`electron/audioHelper/`（主进程）、`src/components/app/passthrough/`（页面 hook）、`src/services/passthrough/`（类型与状态）、`src/stores/usePassthroughSettingsStore.ts`（设置，存储键 `passthrough_*`）。

## 9. 桌面版当遥控端（遥控服务器）

桌面版（安装包）自带全套后端、本机播放，**只当遥控端，不能被遥控**：它不开任何端口，也不带 Stage 中继。

- 设置 → 播放控制 → **遥控服务器**：填服务器地址（如 `http://192.168.1.10:3000`）和 Host 页上的访问令牌，点「打开遥控窗口」。命令面板里也有「打开遥控窗口」。
- 做法：在一个独立窗口里打开服务器自己的遥控页（带令牌的网址），所以遥控界面与手机、网页版完全一致，不重复实现；声音仍从服务器出。
- 这个窗口没有 preload、开了沙箱和 `contextIsolation`，只允许停在服务器这个域名内、不能新开窗口，页面拿不到本应用的任何能力。
- 令牌只存在主进程里，用系统凭据（Windows DPAPI）加密保存，设置页只知道「有没有保存」，不会再读回；没有系统凭据的 Linux 才以明文保留（和 AI 密钥一样的取舍）。
- 桌面版里原来的「播放位置：控制服务器 / 本机播放」不再出现：桌面版页面的地址背后没有中继，那一项在桌面版里是连不通的。
- 代码位置：`electron/stageRemote/`（主进程）、`src/components/modal/settings/pages/RemoteServerGroup.tsx`（设置）。

## 9.1 Spotify / YouTube Music 的代理服务器（桌面版，Windows）

两个服务在部分地区连不上，桌面版有自己的代理设置（设置 → 连接与集成 → **代理服务器**），不影响应用的其他部分。

- 三种模式：**跟随系统**（默认，等于此前的行为）、**直连**、**自定义**（`http://`、`https://`、`socks5://`、`socks4://`；带用户名密码的地址会被拒绝）。「测试连接」会用当前页面上的设置试连两个服务。
- 作用范围：两个服务的网络会话（API、登录、浏览）、YouTube Music 网页登录打开的浏览器（`--proxy-server` / `--no-proxy-server`）、Spotify 播放组件（librespot）。保存后会话立即重载，Spotify 播放连接从下一首起重连。
- **Spotify 播放只能走 HTTP 代理**：上游的 `@lox-audioserver/node-librespot` 没有代理选项，安装包用 `packaging/windows/librespot-proxy/`（`npm run build:librespot-proxy`，需要 Rust MSVC）给 `createSession` 补一个 `proxy` 字段后重新编译，CI（`together-installer.yml`）在打包前执行。补丁在包版本变了、对不上时直接报错（`test/unit/electron/librespotProxyPatch.test.ts` 对着真实包源码检查）。选了 SOCKS 代理时，浏览和登录走代理，播放直连，日志里有 `[NetworkProxy]` 提示。没有补丁版组件（非 Windows、本地开发）时 `proxy` 被忽略，播放直连。
- 代码位置：`electron/networkProxy/`（设置、地址解析、探测）、`electron/main.cjs`（会话与 IPC `network-proxy-*`）、`src/components/modal/settings/pages/integration/NetworkProxyGroup.tsx`（设置页）。

---

## 9.5 服务端与桌面版：哪些共用，哪些不共用

目标是**一处改、两边都有**。界面和各平台的包是一份；服务端与桌面版只在「怎么托管」上不同。

| 部分 | 服务端（网页版） | 桌面版 | 共用情况 |
| --- | --- | --- | --- |
| 界面 | `src/` | `src/` | **同一份** |
| 各平台的包与版本 | 仓库依赖（`package-lock.json`） | 同一个依赖 | **同一份** |
| 网易云 | `scripts/start-netease-api.cjs` | `electron/netease/` 工作线程 | **同一份代码与补丁**（服务端直接启动桌面版的工作线程；不再用仓库外的 `api-enhanced`，`API_DIR` 仍可改用旧办法） |
| QQ 音乐 | `scripts/start-qq-api.cjs` | `electron/qq/` | **启动逻辑同一份**（`startQqApi`）；登录态保存方式不同（服务端文件加密，桌面版系统凭据），有意不同 |
| 遥控接口 | `server/stage-relay` | 同一个 `electron/stageApi.cjs` | **同一份路由与状态逻辑** |
| Spotify | `server/stage-relay/spotify.cjs` | `electron/spotify/` | 中继直接用桌面版的桥接代码 |
| 酷狗 | `scripts/start-kugou-api.cjs`（库自带的 HTTP 服务 + 一处内存补丁） | `electron/kugou/kugouApiBridge.cjs`（进程内、白名单操作、加密会话） | **包同一个，调用方式不同，有意不合并**：桌面版不开端口、只放行白名单操作，服务端的库只绑本机、前面有中继 |
| 版本与更新 | 从仓库 `git pull`（`start-stage.cmd --auto-update`） | 从同一个提交构建的安装包（应用内更新） | 同一个提交，见第 10 节 |

只在一边的功能（有意）：桌面版有直通播放、遥控窗口、检测更新、本地文件与登录窗口、壁纸；网页版有中继、Host 页、手机遥控。

还没有合进来的两条部署路径：`deploy/docker/`（自带的网易云、酷狗镜像与网关）和 Vercel 的 `api/` 函数，它们各有自己的后端，改后端行为时要单独看一眼。

**改后端时的做法**：先看这张表。放在 `electron/` 里、不依赖 Electron 的模块（网易云、QQ 启动、遥控接口）服务端可以直接用，所以优先改那里；只在酷狗这类「有意不同」的地方才分别改。

## 10. 安装包自动发布

每次推送到 `stage-remote`，GitHub Actions（`.github/workflows/together-installer.yml`）都会在 `windows-latest` 上构建一个新的 Windows 安装包（含直通播放器、分析模型），发布到名为 **together-latest** 的滚动预发布页，文件名 `Folia-Together-v<Fork 版本>-<提交>-Setup.exe`；同时留一份 14 天的工作流产物。发布页始终只有最新的那一个。同一页还有免安装的便携版（文件名 `…-Portable.exe`，同样带 `.sha256`）：数据放在 exe 旁的 `FoliaData`（electron-builder 的 `portable` 目标设置 `PORTABLE_EXECUTABLE_DIR`，`electron/main.cjs` 据此改 userData），更新时下载新的便携文件放到旁边。

- 安装包没有数字签名（Windows 会弹 SmartScreen）；同时发布一个 `.sha256` 文件，更新时用来校验。
- **不用上游的更新通道**：`package.json` 的 `foliaReleaseChannel` 是 `internal`。否则安装版会去检查上游 `chthollyphile/folia-major` 的发布并提示更新成上游版本，Fork 的功能就没了。
- **自己的检测更新与更新**（设置 → 通用 → 本 Fork 更新，启动后也会检查一次，可关）：问发布页 `together-latest`，用 GitHub 的 compare 接口判断它是否比本构建的提交新；有新版就下载安装包、校验 SHA-256、退出本应用并运行安装程序（Windows 的安装版，开发运行不检查）。下载地址由主进程从 GitHub 的答复里取，必须是本仓库的发布文件，页面只能「检查」和「安装上次找到的那个」。代码在 `electron/togetherUpdate/`。
- **服务端与客户端怎么保持同一份代码**：一次推送，两边都跟上，都出自同一个提交。
  - 客户端：CI 从这个提交构建安装包，应用里检测更新、一键安装（上面）。
  - 服务端：`scripts\start-stage.cmd --auto-update` 启动后，每 5 分钟（环境变量 `STAGE_AUTO_UPDATE_MINUTES` 可改）问 GitHub 这个分支有没有新提交；有就快进合并、依赖变了就 `npm ci`、重启全部服务。工作区有未提交的改动时不会合并，只打一行说明；检出里的提交变了（本机提交）而服务还在跑旧的，也会重启。手机、浏览器和 Host 页用的是服务端的页面，所以服务端更新后它们自动是新的。
  - 不强行一致也能用：遥控窗口打开的是服务器自己的页面，遥控协议永远和服务器同版；本机播放、直通、各平台后端都在客户端本地。设置 → 播放控制 → 遥控服务器里会显示服务器的版本（中继的公开接口 `/stage/version`），和本应用不同时标成警告。
- 连续推送会排队，不会中途打断发布。

## 维护约定

- **版本号**：Fork 有自己的版本号（根目录 `FORK_VERSION`，从 `1.0.0` 起，当前值见该文件），与上游 `package.json` 的版本互不影响；规则与每个版本的变更见 [Fork 更新日志](../FORK_CHANGELOG.md)。
- **分支**：`stage-remote` 为 Fork 的主开发分支，所有改动先在这里提交与验证。
- **同步上游**：`git fetch upstream`（`https://github.com/chthollyphile/folia-major.git`）后合并，冲突就地解决，随后跑 `npx tsc --noEmit -p .` 与 `npx vitest run -c vitest.config.ts`，并更新本文档。
- **提交规范**：`feat(范围): …` / `fix(范围): …` / `chore(范围): …`，范围如 `stage-remote`、`library`、`layout`、`playback`、`ai`、`scripts`。
- **设置存储**：新增设置项的 localStorage 键记录在 `test/unit/stores/storeContract.test.ts` 的快照里，新增或改名时需要更新快照。
- **推送即出包**：每次推送 `stage-remote` 都会自动生成新的安装包发布（见上一节）；推送后要到 Actions 里确认这次构建成功，失败了要修。
- **不提交**：`.env.local`、令牌文件（`~/.folia-stage/token`）、任何账号 Cookie 与 API Key。
