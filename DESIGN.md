---
version: beta
name: Milu
description: Partner 数字员工桌面应用（Agent Harness 方向，由 qiaomu-design Phase 2 四方向预览选定「C · 终端」）。界面语言是**冷静的工具**：机器事实优先，等宽承担路径/命令/计数/时间戳，正文用 Public Sans 读，一个红只做信号。无「信」的隐喻、无纸纹、无阴影堆叠、无装饰图形。品牌形象只出现在 logo 与字标里。三态主题（system/light/dark，默认 system）。

colors:
  canvas: "#ffffff / #0d0f12"
  chrome: "#80808014 / #131619"
  surface: "#ffffff / #14171b"
  hover: "#80808029 / #1a1e23"
  selected: "#80808038 / #20252b"
  ink: "#0f1115 / #e8eaed"
  ink-soft: "#6b7280 / #99a0a8"
  muted: "#6b7280 / #a3aab3"
  muted-soft: "#aab1bd / #7d848d"
  line: "#e5e7eb / #23272d"
  line-soft: "#eceef1 / #1b1f24"
  line-strong: "#c1c4c8 / #33373d"
  signal: "#d1242f / #e5484d"
  signal-soft: "#e5484d14 / #2a1618"
  on-ink: "#ffffff / #0d0f12"
  link: "#4176e6 / #6ea8ff"
  caption: "#adb2b8 / #4a4f57"
  code-bg: "#fafafa / #16191d"
  code-block-bg: "#f9fafb / #14171a"
  find: "#ffdf5d / #ffd33d44"
  scrim: "ink 22% / canvas 78%"

typography:
  sans-family: Public Sans
  serif-family: Newsreader
  mono-family: JetBrains Mono
  body: Public Sans 15px / 25.7px
  machine: JetBrains Mono 10-13.5px
---

# Milu — Design System

> 唯一事实源。改风格 = 先改这里。四个值域记死：**一个红**、**一根 0.5px 线**、**三个字号族**、**四档圆角（4 / 6 / 8 / 12）**。

## 1. 视觉主题与氛围

Milu 是一个 Agent Harness：你选中一位 partner（atlas、bramble、cinder…），它读文件、跑命令、回消息。界面不是"信纸"，是**工作台**：

- **两层平面，不是一层**（2026-09-29 定，这是本系统最要紧的一条）：
  - **content = `canvas`**：白（暗色 `#0d0f12`）。对话、文档、代码、diff 住在这里。
  - **frame = `chrome`**：`#f6f8fa`（暗色 `#131619`）。左侧 rail、对话列表、设置左栏 —— 框架整体退后一档（聊天窗的顶带与 composer 条都不是 chrome 面）。
  - 再加两个状态：**raised = `surface`**（白 + 线/一层阴影：弹窗、菜单、输入框、代码块外框）；**inset = `hover`**（灰：代码块底、引用、hover）。
  - 起因：`#fbfbfc` 那版把**整个窗口**都涂成一个颜色（约 96% 面积同值），视觉上就是"一大块白、没有重点"；颜色值不是问题，**分配**才是。亮色层的取值来自 github-light 的真实工作台色板（`editor.background #fff` / `sideBar.background #f6f8fa` / `list.hoverBackground #ebf0f4` / `list.activeSelectionBackground #e2e5e9` / 边框 `#e1e4e8`）。，机器事实用等宽字说话 —— 路径、命令、计数、时间戳、模型名，一眼能看出"这是机器说的"。
- 人话用**无衬线（Public Sans）**：对话正文是这条流水线上唯一"要读"的东西，`--font-reading` 指向 sans token（2026-09-30 把代码里误留的 mono 改回来，与 §3 的实测记录一致）。衬线（Newsreader）退到题字角色。
- 机器事实用等宽（JetBrains Mono，即身份层）：路径、命令、计数、时间戳、模型名。
- 层级**只用线**：0.5px 亚像素发丝线 + 底色深浅 + 字重字距。全项目没有阴影堆叠，只有一个例外（§6）。
- 唯一的彩色是信号红 `#d1242f`：危险、未读、正在写、"需要注意"。它不做装饰、不做主题色、不做渐变；**动作与模式也不用红**（停止按钮、shell 模式、选中态、开关 on 态一律走 ink）。
- 品牌形象只在两处：**logo**（线描的米露）与**字标**（手写体 `Milu`，一笔连写，见 §11）。UI 里不出现狗、不做空态插画、不给按钮配图标。
- 暗色不是"夜纸"，是同一张工作台的熄灯态：底 `#0d0f12`、面 `#14171b`、墨 `#e8eaed`，红提亮一档 `#e5484d` 以保住小字对比度。

## 2. 色板与角色

所有颜色都是 `@theme` 里的 `light-dark()` 双值，靠 `color-scheme` 解析；组件只读语义 token，不写死 hex。
**2026-10-09 起，色板照单全收 Claude 的设计系统**（线上 `design-md/claude/DESIGN.md`，sha256 `3d972f34…`）：
中性层与语义层用它给的值，**主色家族是我们自己的**（`#897B67`）。括号里是实测对比度（WCAG，亮色对 canvas `#faf9f5`）。

| token | 亮 / 暗 | 角色与用法契约 |
|---|---|---|
| `canvas` | `#faf9f5` / `#181715` | 内容面：正文、对话、代码、diff。**亮色是奶油底，不是纯白** |
| `chrome` | `#f5f0e8` / `#1f1e1b` | 框架面：侧栏（含 windowbar）、对话列表、设置左栏（= Claude `surface-soft`） |
| `surface` | `#faf9f5` / `#252320` | 抬升面：composer、弹窗、菜单、输入框。**亮色与 canvas 同值** —— 参考自己的 `text-input` 就写「Background `{colors.canvas}` + 1px `hairline`」；抬升感由 0.5px 发丝线 + 7% 浅影给，不是靠压暗 |
| `surface-card` | `#efe9de` / `#2a2823` | 真·卡片面（看板/feature 那种）：**只给成块的卡用，不冒充抬升面** |
| `surface-soft` / `surface-cream-strong` | `#f5f0e8` · `#e8e0d2` / `#1f1e1b` · `#2a2823` | 带子与强调带（备用层） |
| `ink` | `#141413` / `#faf9f5` | 标题、主体文字（17.5:1 ✓） |
| `body` / `body-strong` | `#3d3d3a` · `#252523` / `#c9c5bd` · `#e6e2d9` | **阅读正文**（10.3:1 ✓）/ 加重的段落。正文用 `body`，不要用 `ink` |
| `ink-soft` · `muted` | `#6c6a64` / `#a09d96` · `#8b8880` | 次级文字 / 机器事实小字（5.13:1 ✓；**在卡片底上只有 4.48 ✗，卡片里的小字用 `body`**） |
| `muted-soft` | `#8e8b82` / `#6e6b64` | 三级：时间、占位符、tip（3.23:1 ✗ → **只做装饰**；"要读的小字"一律换 `muted`/`body`） |
| `line` / `line-soft` / `line-strong` | `#e6dfd8` · `#ebe6df` · `#c4beb3` / 12%·8% 白 · `#4a4640` | 0.5px 发丝线三档（= `hairline` / `hairline-soft`） |
| `hover` / `selected` | `ink 7%` / `ink 12%` 墨洗 | 状态层。**跟着 `ink` 走**，所以暗色自动变成白洗 |
| `primary` | `#897b67` / 同 | **主色**：描边、选中、图标、强调（3.91:1 ✓ 图形线；当底色放字只有 4.12 ✗） |
| `primary-fill` | `#7a6d5b` / 同 | **CTA 底色**：比主色深 2.5%（肉眼不可辨），白字 **5.04:1** ✓ |
| `primary-active` | `#605546` / `#b09f87` | hover / press（暗色变亮不变量） |
| `primary-disabled` / `primary-soft` | `primary` 16% 进 canvas / `primary` 12% 透明 | 禁用态 / 选中底 |
| `on-primary` | `#ffffff` / `#181715` | 主色上的字 |
| `signal` | `#c64545` / `#d96868` | **唯一彩色信号**：危险、未读、正在写、需要注意（4.59:1 ✓ 可当字） |
| `signal-soft` | `signal` 10% 透明 | 红的底（错误块） |
| `success` / `warning` | `#5db872` · `#d4a017` / `#6fc884` · `#e0b24a` | 成功 / 警告：**只能当圆点或填充**（2.33 / 2.25 ✗ 当字不够） |
| `accent-teal` | `#2f7a6b` / `#5db8a6` | **「活着」专用**：writing / 运行中 / 已连接 / busy 的呼吸点（4.84:1 ✓ 可当字）。参考给的是 `#5db8a6`，在 canvas 上只有 2.25:1 ✗，取了它深一档 |
| `find` / `find-soft` | `#e8a55a` / `#e8a55a66`（暗 33%/18%） | 查找命中：**改用它的 `accent-amber`**（原来是柠檬黄 `#ffdf5d`，在奶油底上偏冷）；命中当底色，字仍是 ink |
| `link` | `#716553` / `#b09f87` | 链接：**主色系、不再用蓝**（参考的 `text-link` 就是主色，Do's 明禁冷蓝）；但取主色**深一档**——参考那条只有 3.28:1、主色本身 3.91:1 都不够字面 AA，这一档 5.40:1 ✓ |
| `hlv-0..4` | `heat`（深赭 `#97652f`）12 / 32 / 52 / 71 / 90% 兑 canvas | 活跃度热力：**暖米→赭**，等 L\* 步 92/82/72/62/52（C 0.015→0.055）。源另立 `--color-heat`（由参考的 `accent-amber` 压暗保住彩度）：**不能拿 primary 当源**，它 chroma 仅 0.022，兑出来还是灰阶 |
| `caption` / `code-bg` / `code-block-bg` / 选区 / `scrim` | 见 style.css | 引用条、内联码（`#efe9de` 暖底）、代码块（`#f5f0e8`）、活跃度灰阶、`selection` 墨洗、遮罩（`ink 22%` / `canvas 78%`）。**代码面保持「随主题」，不改成常暗** —— 参考的深色只是营销页展示产品 chrome 的卡，不是产品自身的代码面规则 |

**三条从参考里带来的硬规则**（都是量出来的，不是抄的）：
1. **CTA 底色比主色深一档** —— 参考自己的珊瑚 CTA（`#cc785c` + 白字 = **3.28:1**）低于 AA 4.5；照单全收时**这一条不抄**，我们取 `primary-fill`（5.04:1）。
2. **语义色的字面用法分开**：`success`/`warning` 只做点与填充；要写成字必须换深一档（我们的状态点已如此）。
3. **`muted-soft` 只做装饰**：它在 canvas 上 3.23、在卡片上 2.82，都不够；凡"用户需要读它来判断状态"的小字，一律 `muted`（canvas 上）或 `body`（卡片上）—— 这是账本 P-83 的落地口径。

**已办（2026-10-09 第二阶段）**：`link` 改主色；代码面暖色化（冷白 `#fafafa`/`#f9fafb` → `#efe9de`/`#f5f0e8`），**明确不改成常暗**；P-83 落地：带字号的 `muted-soft` 文字全部升到 `muted`（CSS 56 个类 + tsx 52 处，只留 3 个纯装饰字形类）。**热力阶梯**：从 ink 墨洗（中性灰）改成**暖米色** —— 以 `primary` 为源兑 canvas，等 L\* 步 92/82/72/62/52，顶档即品牌主色；旧的 ink 版在奶油底上不同族。

**红与青的分工（2026-10-09 定）**：`signal` 只留「需要注意」（未读、失败、超限、错误）；**「活着」——writing、运行中、已连接、busy —— 一律 `accent-teal`**。旧实现里 `.btw-flow-loading` 与 `.explorer-busy` 两个「忙」的点是红的，MCP `connected` 是中立的 `bg-ink`，现在都归到青。

## 3. 排版规则

| 角色 | 字族 | 用在哪 | 字号 / 行高 |
|---|---|---|---|
| 阅读 | **Public Sans**（`--font-reading` → sans token） | 对话正文、markdown 正文、空态说明 | **15px / 25.7px**（`--text-reading` × `--leading-reading`） |
| 机器 | JetBrains Mono 400-600 | 路径、命令、计数、时间戳、模型名、代码 | 10-13.5px |
| 题字 | Newsreader 400-600 | 视图标题、partner 名、设置索引（**不再用于正文**） | 16-18px |

**字阶（2026-10-09 收敛：11 档裸值 → 6 档角色）**。角色名沿用 Claude 的 `typography`，缺的一格是我们补的：

| 档 | 对应它的角色 | 用在哪 | 现状 |
|---|---|---|---|
| **10** | （我们补的 `micro`） | 机器事实：路径、计数、时间戳、键帽、状态 | 179 处，是全 app 的脊柱，**它那份最低只到 12px，此处刻意不跟** |
| **12** | `caption-uppercase`（12/500/1.5 字距） | 全大写小标签：表单 label、分组眉批 | 129 处 |
| **13** | `caption`（13/500/1.4） | 元信息：说明行、次级计数 | 43 处 |
| **14** | `body-sm`（14/400/1.55） | UI 正文：设置行、输入框、菜单条目 | 34 处 |
| **15** | （我们的阅读档，它没有） | 对话与 markdown 正文（`--text-reading`） | 单一来源，改字号只动这一个 token |
| **16** | `title-sm` / `body-md` | 小标题、面板标题、消息里的强调行 | 20 处 |
| **18** | `title-md`（18/500/1.4） | 弹窗标题、视图标题 | 9 处 |

- 阅读层四个 token 只在 `@theme` 定义一次：`--text-reading: 15px` / `--leading-reading: 1.714` / `--gap-reading: 16px` / `--font-reading`。改字号只动 `--text-reading`。
- > 2026-09-30：阅读层照 `127.0.0.1:3080`（dsh）实测值抄 —— 它的正文就是**系统无衬线 14px/24px、列宽 640px**（我们取 15px）。这覆盖了 9/29 锁定的「正文保留衬线」；衬线退到「题字」角色（视图标题/人名）。字号/行高/段距/字体四个 token 都在 `@theme` 里，改字号只动 `--text-reading`。
- 禁斜体（强调用字重/颜色/字号）；禁纯黑；数据不用衬线（唯一的例外见 §10 的接线声明与设置页分类索引）。
- 圆角四档：**4px**（chip / 键帽 / 工具块）、**6px**（菜单条目 / 列表行）、**8px**（按钮 / 输入框 / 浮层容器）、**12px**（面板 / 弹窗 / 卡片 / composer 盒）。（2026-10-09 照 Claude 的 `{rounded.xs…xl}` = 4/6/8/12/16 重排；旧的 1.5 / 3 / 22 三个历史值已消失，`22` 是当年的 composer 药丸，早被两层盒子取代。）

## 4. 组件样式

- **transcript（一条流，靠位置与距离说话）**：2026-09-29 由四方向预览选定 **B · 纯留白**（`design-previews/2026-09-29-transcript/`）。**没有角色文案、没有分隔装饰线**。
  - **右侧气泡 = 你说的**：`msg-user` = `hover` 底 + 6px 圆角 + 9/13 padding、`max-width: 74%`、`width: fit-content`、`margin-left: auto`、serif 15.5px/1.6。它说的走左对齐 flush 正文（`msg-body`，serif 16px/1.62）。**位置就是标签**，所以一个字都不写；`sr-only` 里保留角色名给读屏。
  - **时间在内容下方**（`msg-meta`：mono 10px `muted`，tabular；完整日期进 `title`），**默认 `opacity: 0`，`hover` / `:has(:focus-visible)` 才淡入（140ms）**（2026-09-30 修：用 `:focus-within` 时，鼠标点一下复制/编辑/正文里的链接就把这一块钉住了，移出也不消失；`:has(:focus-visible)` 只认键盘焦点）；`@media (hover: none)` 常显；`prefers-reduced-motion` 去过渡。**行高 15px 先占住** —— hover 只改透明度，绝不推动布局。**「回到最新」是居中、纯图标的 30px 圆**（`.back-to-bottom`）。`from/to` chip 与编辑铅笔同在这行。
  - **三档间距**（不用任何装饰线）：同一人接着说 **20px** · 换轮（你说的新气泡） **40px** · **跨日 54px 上 / 24px 下**。
  - **跨日分割是唯一的"线"**：一行 mono 10px 日期（tracking .16em，居中，两侧各 44px × 0.5px `line`）。日期之后不再重复写日期。
  - 正在写的块：三个 `work-dot`（1s 错峰），无文案、无装饰。
- **markdown 正文层（2026-09-30 照 dsh 实测抄）**：段落间距 **16px**（`--gap-reading`）· 首末子元素外边距 0 · `h2` **19px/700/28 + 上 32 下 16**、`h3` 16px/600/24 + 24/8 · 列表项间 **6px**、嵌套 4px、marker 用 `ink-soft` · 加粗 **600**（不是浏览器的 bolder/700：字重掉一档，黑才不压纸）· 链接 **`#4176e6`、weight 500、无下划线**，hover/聚焦出 `underline dotted` offset 3px · 引用 **2px `caption` 灰条 + 14px 缩进**、文字不缩号不换色 · inline code **11.375px/19px、底 `#fafafa`、0.5px 极淡描边、圆角 6、`padding: 0 5px`** · 代码块 **底 `#f9fafb`、圆角 12、`padding: 13px 22px`**（2026-09-30 修：原来照抄 dsh 的 `6px 22px 20px`，但 dsh 首行自带额外 leading，我们 19px 行盒 / 11.4px 字上下各 3.8px 已对称，6/20 会直接显成「上 13 / 下 27」；改成等分、总量不变、块高不动）、11px/19px、`margin: 16px 0 11px`** · 表格单元 13px/22px、`padding: 10px 16px 10px 0`、表头 weight 500。
- **BTW 旁批（保留的交互，全项目签名交互）**：agent 块右侧常驻一条 30px 热区，hover/聚焦出 16px 指示器（默认竖直、窄屏改 24px 角落按钮）；点击在块右侧展开 `--btw-note`（240px）宽的旁批栏，栏与正文之间 42px gap + 0.5px `line`。旁批内的消息同样是 meta 行 + 正文，但正文缩到 13px。
- **composer**：**一个盒子、两层**（2026-09-30 定，照 dsh 的 composer 结构）。**上层**只放输入（textarea）；**下层**是动作行：**开关 `$`（shell 模式）与 tasks 靠左**，右侧一组 = model·effort chip + context meter + submit（忙时变**描边停止圆**：`ink/40` 描边 + `ink` 图标，**不写红** —— 停止是动作，不是「需要注意」）。盒子**自己不带 padding**（拆到两层里：`px-4` / `px-1.5 pb-2 pt-0.5`；盒子离窗口底的 12px 由 `.composer-slot` 给）、`surface` 底、**0.5px 发丝描边**、圆角 12、**一层浅影**（§6 的浮层例外）；**聚焦不改描边**（`form#composer` 也不带 padding，留白给 `.composer-slot`，这样 `--dock-bottom` 仍能量到）。下层每个控件的**外框 = 26px**（= context meter 的 `p-1.5` + 14px svg；图标大小各自不变：tasks 15、submit 13）—— 注意别用共享 `Button`：它的 `size="icon"` 会把框锁成 40px，这一行用裸 `<button>` + `composer-icon-btn` / `composer-send`。宽度与 transcript 同列（共用 `--transcript-measure`，见 §5）。**输入卡比消息列每侧宽 16px**（`max-width: calc(var(--transcript-measure) + 32px)`；dsh：654 → 686 实测 +32），所以卡内文字回到列的同一条轴（input 层 `px-4`，残差 0.5px = 描边）。盒子高度与列宽成比例（700 宽 → **81 高**；比 dsh 的 686×89 矮 8 —— 输入层顶部那 8px 去掉了，文字在自己的带里 12/12 对称），所以 input 的上下留白是 `py-12px` 而不是贴着字。**卡下面另起一行 tip**（`.composer-tip`，与卡隔 **4px**、**不连在一起**，**居中**；sans 10px `muted-soft`，无分隔线）：`/` 命令 · `@` 提及其他会话 · `⇥` 切换模式（空输入时切 shell）· `⏎` 发送 —— 键帽统一用 **`ui/kbd.tsx`**（shadcn 的 `Kbd`，`h-5 / min-w-5 / px-1 / text-xs / 500 / 无描边`，底 = 我们的 `hover` tint、字 = `muted`、圆角 4）。**一个键一颗键帽**：修饰键各自成颗、组合用 `KbdGroup`（gap 4px）—— 侧栏 Settings 是 `⌘` + `,`，palette 是 `⌘` `⇧` `P` / `⌘` `↵`，composer tip 是 `⇧` `⏎`；`↑↓` 这种「一个手势」的合键仍算一颗。小号的 inline 输入框仍用 `.composer-field`（ChatInput 的 sm/annotation 变体），不吃这套两层结构。
- **shell 模式**：开关是下层动作行**最左边那枚 `$`**（`composer-icon-btn.on`，位于 tasks 左侧），**点击与空输入 `⇥` 是同一个 toggle**，`Esc` 也能退出；激活时 **卡的描边转 `ink`**（0.5px，仍在「线」的语言里，**不用红**——模式不是信号）。input 转等宽、placeholder 变 `Run a shell command…`、tip 行整行换成 `⏎ 运行 · ⇧⏎ 换行 · ⇥ 退出模式`。行首的 `$` 前缀与 `shell` 小签已删（开关自己的状态就是说明）。
- **partner 列表行**：4px 圆角、行距 2px、hover `hover`、**选中 = `selected` 整块底色**（禁止左侧竖线，账本 P-38）；行 = 名称（首字母头像 28px）+ 预览（截断）+ 时间（mono 10px tabular）；未读 = signal 4px 点。
- **brand 行**（sidebar 顶部）：**`assets/milu.png` 那张唯一的图**（26px，圆角 6）+ 手写体字标 `Milu`（`MiluWordmark`，20px 高 / ≈86px 宽，见 §11）。线上不再画 inline SVG 版狗头（同一只狗两种画法 = 两套视觉，§11 早就禁了；`design-previews/2026-09-29-milu-skin/` 里那个 `#dogline` 的 `viewBox` 还会切掉右耳与下巴）。
- **dialog / panel**：`surface` + `line` 描边 + **12px** 圆角、**无阴影**；**menu / tooltip / select 浮层容器 8px**，条目仍 6px；focus-visible 用 `ink` ring + 2px offset（禁浏览器默认蓝）。
- **遮罩（scrim）**：`--color-scrim` —— 亮色是 **`ink` 22% 的中性灰洗**（不是拿 `canvas` 当 80% 的白纱，那样只是把画面洗白），暗色是 `canvas` 78% 的熄灯。所有 `DialogOverlay` 共用它。
- **详情弹窗里的红**（2026-09-30 清）：`● writing` 徽章、指标卡下面那行 delta、memory 存储条、run 行的 `Trajectory` 按钮 —— 全部改成 ink/muted 语言（前三个本来就不是「需要注意」，最后一个只是入口）。**留下的是真信号**：memory 详情超限的警告、非 `completed` 的 run reason、错误文案。
- **按钮**：文字按钮一律 **8px**（`ui/button.tsx` 的 `default/sm/lg` 都带 `rounded-[8px]`，base 里的 `rounded-full` 已删）；**图标按钮 / 头像保持全圆**（它的 `{rounded.full}` = icon buttons）。
- **工具/状态块**：命令、diff、日志、escalation、任务日志一律 mono、`surface` 底、4px 圆角；错误用 `signal-soft` 底 + `signal` 字。
- **代码（markdown 围栏）**：shiki 的 github-light/dark 自带六种色相（keyword 是红的），按角色重映到我们的 grays + 两个低饱和辅色（keyword `#3f4d63`/`#9fb0c9`、string/tag `#45624f`/`#9dbba8`），只有 invalid 保留 `signal`。映射挂在**主题对象**的 `colorReplacements` 上，键必须小写（见 `lib/shiki-setup.ts`）。
- **markdown**：引用条 2px `line-strong`；内联码 `hover` 底 + `line` 描边；表格/正文用 ink/ink-soft；链接见 §2。
- **设置页**：660×540；左侧 168px 分类栏（分类名 12.5px，选中 = `selected` 整块，底部**不放字标**（P-91：品牌只在 sidebar brand 出现一次）（2026-09-30 调：**分类栏与内容同底、无中间竖线** —— 分类栏从 `chrome` 换成 `surface`，`border-r` 删掉，整块面板就一张白；**Switch 的选中态用 `ink` 不用红**（红只留给「需要注意」）；搜索框用 `TextFieldInput variant="quiet"`，**聚焦不描边不 ring**；Theme 三个卡片的选中态描边 `ink → line-strong`，选中感交给 `selected` 底色。）；右侧 = 搜索（`surface` + `line` + 3px，mono 计数）+ 行列表（`divide-y`，不套卡片）行 = 标题 13px + 描述 11.5px `ink-soft` + 右缘控件；**修改标记 = signal 圆点 + "modified" mono 10px**（点，非竖条）。
- **自定义滚动条**：6px，`line` thumb。
- **命令菜单（⌘P）**：快捷键一律是 **`Kbd` 键帽**（头部那颗 `⌘P`/`⌘⇧P`、底部 `⇥ switch · ↑↓ navigate · ↵ open/editor · esc close`），不是一段等宽字符串。**选中行不再把标题变红**（选中靠 `hover` 整块底），时间/光标/`#range` 小签/状态行都走 `muted`（`#range` 是 0.5px 描边的安静 chip），**只有 `grantError` 那条状态才是 `signal`**（`.palette-status.err`）。

## 5. 布局原则

- **两栏：sidebar + main**（2026-09-30 定，参照 dsh desktop：`https://www.deepseek.com/harness/` hero 的 `HarnessDesktopPreview`）。原左侧 64px 图标栏（rail）已删除；skills / dashboard 的入口暂时隐藏（视图代码保留，走应用菜单仍可进）。
- **sidebar**（chrome，可拖拽：200–480，默认 240，给 main 留 592px）自上而下四段：**windowbar 52px**（红绿灯压着左上 76px，本行内容因此从 88px 起，和 `.chat-bar.at-edge` 同一条；行内自左到右 = **搜索｜新建｜收起侧栏**，`justify-end`，离侧栏右缘 12px。**搜索**与**新建**是同一个 26px 图标类（`.conv-icon-btn`）—— 一致性由类保证，不是靠两边各自写一遍；**搜索**点击/⌘F 才滑出字段（字段 **32px 高**、只吃本行的余量，**新建与收起不移位、不卸载**；默认 240 宽下余量窄，侧栏拖宽字段才舒展））/ **brand 44px**（`assets/milu.png` 26px + 手写体 `Milu` 20px 高 —— 实测放不进 windowbar：侧栏默认 240 时内容宽只有 216，字标只剩 72px 可渲染 = 12.5px 高，不成立；下沿一条 0.5px 线，头部因此读成一条带）/ **body**（chat list，`flex-1`；行 `py-6` + 头像 28px = 行高 49）/ **foot**（34px 行，贴底：左边齿轮，右边 `⌘` `,` 键帽 —— **不写 “Settings” 文案**，位置 + 图标已经说明了，快捷键才是这条行要告诉你的信息）。头 : 脚 = 44 : 34（原来是 33 : 38 的「头轻脚重」）。
- **顶栏是「一窗两条」**：sidebar 的 windowbar（红绿灯 + 搜索/新建/收起开关）；**main 自己的条**（`.chat-bar`，52px，画布同色 + 一条发丝线）整行左边是 **explorer / git / worktrees（有才出现）跟着 `dockSide` 走**：`right` 时在右侧、排在 replies/trajectory 之前，`left` 时在左侧、跟在收起开关之后（分隔线永远夹在它们与窗格自己的工具之间）；**replies + trajectory 恒在右**，**partner 名（mono 12.5 `ink-soft`，点击开详情）+ Writing status 绝对居中**（`left: 50%` + translate，`max-w-[46%]` 截断——两侧工具再多也不会把名字挤走）。replies 面板挂在条**下面**（`top: 60px` = 52 + 8），不再盖住这两个按钮。侧栏收起时，信条左端出现「展开侧栏」按钮 —— 它等侧栏合上（120ms）才淡入，收起过程中不跟侧栏抢同一处 —— 并整条把左内边距让到 88px（`at-edge`，避开红绿灯区）。
- **DOM：`.chat-main = [chat-bar][chat-column][dock]`**（2026-09-30 定；条是**窗格**的，不是列的）。未 pin 时 `.chat-main` 是 flex 列（条 + 列，dock 绝对定位盖在 body 上）；**pin 时换成 2×2 网格**：`grid-template-rows: auto minmax(0,1fr)`，条 `grid-column: 1 / -1` 横跨第一行，第二行才是 `[列 | dock]`（`side-left` 镜像）。这样 pin **不会碰 windowbar**，只切分 composer 与 body；列宽用 `minmax(0,1fr)` / `var(--column-width, 42%)`（有 detail 时）表达，不再靠 flex 的 `flex: 0 0 42%`。
- **dock 只占 body 那一段**（2026-09-30 定）：未 pin 时 `inset: var(--bar-h) 0 var(--dock-bottom) 0`（绝对），pin 之后换成同一个区间 —— `inset: auto` + `margin-block: var(--bar-h) var(--dock-bottom)`（relative 下 `top/bottom` 是偏移，会和 margin 叠两次）。**pin 时 dock 撑满第二行到底**（不写 `margin-bottom`）。
- **dock 没有自己的 header**：标题与关闭按钮都删了 —— 打开/关闭走条上那两颗按钮（`explorer` / `git`，打开时是 `.on` 的 selected 底色），pin 与「显示文件树」的按钮在 explorer 自己的 head 里。**面板的线全部跟着 `dockSide` 走**：朝向正文的那一侧才有分隔线（靠右 → `border-left`，靠左 → `border-right`），**底部只在未 pin 时收一条 1px 线**（那条下沿正压在 composer 上沿，不收口看起来是「无尽」的；pane / detail / 中间 7px 的 grip 各画一段、接成连续的一条）。这条线是唯一的 owner，所以 pane 的 split grip 平时**只留 7px 热区、不画线**，悬停/聚焦/拖动才显形。`--bar-h: 52px` 定义在 `.chat-window`，条自己、dock 的上沿、replies 面板的上沿**共读这一个值**（改条高只改一处）。
- **reader 的 head 是 VSCode 式的**（2026-09-30 重做）：左/一侧是 **tab 条**（`fileGlyph` 图标 + 文件名 + 关闭 ×，`.on` = `selected` 底色），**动作区**（pin / 文件树 ☰ / 范围 tag + 引用 / raw / wrap）贴在**文件树那一侧**（`dock.side-left` 时整行 `row-reverse`）；tab 条横向溢出时**自己滚，滚动条不占高度**（`scrollbar-width: none`）。旧的三件已删：`← partner` 关闭按钮、文件名 span、`explorer-metrics`。
- **breadcrumbs 是 head 下面独立一行**（`.explorer-dir-row`），与 head 之间**不画线**，线放在 crumbs 下面（正文的上边界）。
- **git changes 的 head 与 explorer 同构**（2026-09-30）：`.git-diff-head` = `[标题：文件名 + `+n/−n` + 错误] | [动作：pin / 文件树 ☰ / reveal / side-by-side / wrap / whitespace]`，动作区同样贴变更列表那一侧，路径单独成 `.git-dir-row`，旧的 `← Changes` 关闭按钮删掉。
- **文件树弹窗落在点击处**：`list.openList(anchor)` 带一个 dock 坐标系里的点（`lib/dock.ts` 的 `dockAnchorPoint()`），DockShell 用它写 `left/top` 并夹在 dock 内（`right: auto`）；☰ 按钮和 crumbs 段都是这么打开的。
- **「点到控件就不抢焦点」是铁律**（2026-09-30）：侧栏和 dock 的根节点都靠 `onClick → currentTarget.focus()` 接管键盘（Esc 层、快捷键要在 pane 里生效），但**点击落在真控件上时必须放行**，否则输入框刚聚焦就被 pane 抢回去（Search chats 点不进去就是这个）。判定统一走 `lib/utils.ts` 的 `isInteractive()`，`zoomOnDoubleClick` 也用它 —— 一个 owner。
- **正文列仍是唯一一条轴**：`--transcript-measure: 700px`， `.transcript-inner` / `.composer-row` 共用它；信的条与之无关（条内的名字从窗格左边起，左内边距 18px）。
- **composer 不再是一条 chrome 带**：与正文同一列居中，没有横贯的分隔线；离开画布靠的是盒子自己的 0.5px 描边 + 浅影（dsh 的 composer 同样是自己成块的）。
- **列宽只有一个 owner**：`--transcript-measure: clamp(720px, 64vw, 980px)`，定义在 `.chat-column`；transcript 内层、composer 行、follow-up dock、命令菜单全部读它（实测各处左缘偏差 0），窄窗由 `max-width: 100%` 再兜一层。
  - 规则来自 dsh：**列 = 窗口宽 × 0.64**（它的 desktop 预览 1021 宽 → 654 ✓），上下限是 dsh 的 680 / 920。
  - **我们的上下限按字号折算，不按窗口**：这两个数是「一行能有多长」的读的度量，只随 `--text-reading` 走。dsh 是 14px → 680/920 = 48.6em/65.7em；我们是 **15px** → 720/980（48em/65.3em）。窗口大小不进这个算式（否则和 0.64 那条规则互相循环）。
  - 结果：≤1125 宽 → 720 底；1125–1531 → 64vw；≥1531 → 980 顶。默认 1200 窗口 = **768**（占 960 窗格 80%，dsh 是 82.6%）。
- **窗格左上那 76×52 属于 macOS，不是画布**（2026-09-30 补）：`titleBarStyle: "hiddenInset"` + `trafficLightOffset { x: 0, y: 10 }`（`src/bun/index.ts` 是这两行的唯一 owner）把红绿灯交给系统画在**窗口绝对坐标**上，DOM 挪不动它。所以**侧栏的顶 52px 是 chrome 且不放内容**（这就是它的 windowbar）；dashboard/skills 没有侧栏，就在自己内容区顶部放一条 `.view-strip`（画布色 + 发丝线，与 `.chat-bar` 同语言）。`.mac-plate`（76×52，drag）保证红绿灯永远在 chrome 上：**它默认透明**（chrome 在亮色是 8% 透明的 `#80808014`，再叠一层就不是 sidebar 那个颜色了 —— 2026-09-30 修），只有侧栏收起、或 dashboard/skills 这种没有侧栏的视图才加 `.tinted`，而那层 tint 是 **`--color-qw-bg`（画布色）= 信条自己的底色**（2026-09-30 改：收起时红绿灯落在信条上，必须和条同色，不能是 chrome —— 否则画布上多出一格灰），并且带一条 `border-bottom: 1px solid var(--color-line)`，把信条下沿那条线**接起来**（两者同高，线落在同一像素：实测 plate 51–52、bar 51–52，偏差 0）。规则三条：区内不放可点元素（点击被系统按钮吃掉）、底子保持 `chrome`、区内的东西一律下移 52px。**这条高度与 `trafficLightOffset.y` 是一对** —— 改一个必须重调另一个；拖动窗口与双击缩放的 owner 是 sidebar 的 windowbar / `.chat-bar` / `.view-strip`（`electrobun-webkit-app-region-drag` + `zoomOnDoubleClick`，实现在 `lib/zoom.ts`）。窗口没有最小宽度，所以满宽/居中的内容要给左边让开这 76px（侧栏在时白送：侧栏 ≥200px；侧栏收起时由 `.chat-bar.at-edge` 的 88px 左内边距兜住）。
- **弹窗的开关动画**：关的那一下要靠 Radix 的 exit 动画，所以**内容不能在 `open` 变 false 时先没了**——`partner`/`run` 这类以实体为 key 的弹窗一律写 `props.x ?? lastX`（本地留一份），盒子才不会先空掉、动画才有东西可动。详情弹窗高度固定 `min(720px, 86vh)`（内容在里面滚），与轨迹弹窗 `min(720px, 84vh)` 同一族。
- 消息间距 16px（密度 5/10），块与块之间不给卡片，只用 gap。
- 一个视觉焦点：**正在写的那一块**（meta 点呼吸 + 正文逐步出现）。
- 停靠面板：explorer / git 各自 `DockShell`，pane 200–420px，可分为 pin（letter 列 + dock 列，宽度可拖）。

## 6. 深度层级

**无投影**。层级靠：线（0.5px）/ 底色深浅（`canvas → surface → hover → selected`）/ 字重。唯一例外：真正浮在正文之上的浮层（FloatFind、命令菜单、dock 读数泡、tooltip、**composer 盒子**）允许**一层**极淡的染色阴影（浮层 `0 4px 12px color-mix(in srgb, ink 12%, transparent)`，composer 更浅：`0 2px 8px … 7%`）；其余一律 flush。

## 7. Do's / Don'ts

**Do**：机器事实用等宽；要读的小字用 `muted`（过 AA）；层级用 0.5px 线；选中用整块底色；一个红只表示"需要注意"；正文用 Public Sans 读；logo 与字标是唯一有形象的地方。

**Don't**：纯黑 `#000000`；第二强调色；装饰性红；阴影堆叠；玻璃拟态；渐变；斜体；左侧竖线选标记（P-38）；Inter/Roboto/Arial 当 UI 字体；600+ 字重铺排；把狗、插画、ASCII 图放进 UI；"信/邮戳/署名/档案"这套隐喻的任何残留（文案与类名都算）；`transition: all`。

## 8. 响应式

桌面优先（960×700 窗口）。宽度收窄时：列表可收起（⌘B）或拖到最小 200px；transcript 列按 §5 的 clamp 自然收窄；composer 与菜单永远与列同宽；meta 行允许换行但角色名与时间不拆行。窄窗（<900px）隐藏 role、BTW 指示器改角落按钮。

主题三态：默认跟随系统（`color-scheme: light dark`，无启动闪烁）；设置页 General → Theme 可强制 light/dark（写 settings.json 的 `theme`，App 应用到 `<html data-theme>`，切换 200ms 纯颜色过渡）。

## 9. Motion 哲学（本页 3/10，界面其余部分维持既有强度）

- 缓动统一强化 ease-out `cubic-bezier(0.23, 1, 0.32, 1)`；屏上位移 `cubic-bezier(0.77, 0, 0.175, 1)`。禁 ease-in。
- **签名交互 = BTW 旁批**（不是装饰动画）：点击右缘指示器 → 旁批栏从块右侧展开（transform-origin 右缘，`--btw-note` 0 → 240px，220ms），同时 transcript 整组左移以保持列居中（240ms）；Esc 逐层退出。
- 新增块入场：`opacity 0 → 1` + `translateY(6px) → 0`，200ms；**没有旋转、没有"盖章"**。
- 正在写：meta 行的 signal 点 1s opacity 呼吸（不做 scale 弹跳）。
- 按钮按压 `:active { transform: scale(0.97) }`，160ms。列表 stagger 40ms，退出比进入快（120ms）。
- 只动 transform/opacity；UI 动效 ≤300ms；键盘触发的高频操作无动画；主题切换 200ms 纯颜色过渡。
- `prefers-reduced-motion: reduce` 移除全部位移类动画，只留透明度；hover 效果包 `(hover: hover) and (pointer: fine)`。
- **三条 2026-09-30 定的动画**：① **chat list 收起/展开** = 宽度与透明度**同一段时长、同一条曲线**（**并行不同速**：透明度 100ms、宽度 120ms，两个方向同一组值，都写在 `.conv-pane` 一处；因为淡出更快，收起时看起来是「先看不见、再合上」；reduced-motion 下两者一起变 none）。② **composer 换模式时 tip 行滑出/滑进**：`AnimatePresence mode="wait"` + 每个模式一个 key 的 motion 行，旧的向一侧滑出（−10px）、新的从另一侧滑进（+10px），回切时方向相反，180ms、app ease。③ **命令菜单入场更柔和 + 有退场**：220ms，`y −8→0`、`scale 0.99→1`（原来 CSS 是 180ms/−6px/0.97），退场 `y −6`、`scale 0.995`；CSS 的 `@keyframes palette-in` 与它的 reduced-motion 覆盖都删了 —— 由组件 + `MotionConfig reducedMotion="user"` 拥有。
- **没有这些**（2026-09-29 删）：轨迹面板的逐条级联入场、dashboard 图表的"画入"、heatmap 的逐格 6ms 级联延迟、模型名的 26px 位移（只留淡入）、盖邮戳式入场、任何 `scale(0)` 或旋转入场。
- **保留的**（它们都在表达状态或按账本 P-82 要求在场）：浮层/抽屉/通知的进出场（pop-in / toast-in-out / traj-drawer-in / traj-popover-in）、`work-dot` 呼吸、`task-live` 脉冲、定位闪烁（底色是 `selected` 中性底，不是红）、skeleton 呼吸。

## 10. Dashboard（Phase 2 选定模块，随 C 重新着色）

- Dashboard 是「账本」：顶部一行关键数（KPI）+ 三张图 + 状态表 + 运行流水，全部 mono 数字、灰阶层级、无装饰色；图表线 = `ink`，端点 = `signal`（唯一的红，表示"现在"）。
- **接线声明**：视图标题 `Dashboard` 用 Newsreader 19px 600（视图族标题语境）；表格与数字一律 Public Sans / JetBrains Mono，不破 §3。

## 11. Logo（品牌形象的唯一出口）

- **形**：线描的狗头（米露，杰克罗素梗）。三条硬约束：① 全图一种笔画粗细（等粗、圆端）；② 零纹理——不画毛发、不排线、不渐变、不投影，白毛即留白；③ 只有一处实心斑（眼周）+ 一个实心点（眼睛），它同时是 16px 能认出狗的关键。
- **色**：底 `#fbfbfc`、墨 `#16181d`（= §2 的 canvas / ink）。红包不进 logo。
- **字标**：手写体 `Milu` —— `MiluWordmark`（inline SVG，**一条填充路径**，`viewBox="52.3 44.1 275.7 63.9"`，`fill-rule="nonzero"` + `fill="currentColor"`）。底稿是用户拿一段手写书法描出来的轮廓（2026-09-30 交付，`~/Downloads/milu_handwrite.svg`），取用时只用墨迹那一层：**丢掉白色底框**（原 viewBox 728×172 里墨迹只占 189×62，右侧 72% 是空的；白色底框在 app 里既不可见又撑大了画布），并把 viewBox 收到墨迹本身。
- **延长线**：u 的末笔原来在 (241, 91) 就收尖了；从笔画内部 (231, 99) 沿原方向（斜率 −0.63，与原笔末端切线连续）接一条 **179 单位**的长尾巴：升到 (310, 82) 的拱顶，再落到 (420, 97) 收成尖，全程从 4.6 单位渐细到 0.15 —— 总墨迹 **367.6×63.8（长宽比 5.76）**。接缝靠 `nonzero` 重叠合并，没有第二条边线。
- **尺寸**：brand 行里高 **20px（≈115px 宽）**。这里是本仓唯一一处**实心笔触**（书法有粗细变化，2–4.6 单位 → 20px 档约 0.6–1.4px），与 logo 的等粗线描分工：logo 是标记，字标是签名。**验证档位**：sidebar 20px / README 40px+。
- **动效**：字是实心的，所以不是描边写出，而是**左→右的墨迹揭示**，并且**循环播放**：`<mask>` 里一条 rect（`transform-box: fill-box`，只动 transform + opacity），一个 6.2s 周期 = 写 2.36s（`cubic-bezier(.5,.05,.4,1)`）→ 停 3.2s → 淡出 0.43s → 隐形归位 → 立刻重写。首帧用 `backwards` 填充，所以启动时不会先闪一下写好的字；`prefers-reduced-motion: reduce` 时 rect 停在写满态。
- **一份资产，不分版**（2026-09-29 定）：只有 `assets/milu.png` 一张图，从 Dock 的 16px 到 README 的 1024px 都用它。**不做剪影版**——同一只狗出现两种画法就是两套视觉，维护成本翻倍，用户记不住哪个才是它。
- **因此这张图必须是「icon-first」的**：按最小尺寸画，而不是按 1024px 画完再缩。量化门槛（都按 86% 满幅折算后量）：**笔画中位 ≥ 标记宽的 7%** —— 16px 档 1px、视网膜 Dock 实取 32px 档 2px。理由与审美一致：粗线是「标记/工具」的性格，细线插画是「文具/贴纸」的性格——后者正是 C 删掉的那条路。
- **不要求外轮廓闭合**（2026-09-29 撤）：闭合只是为了能填出实心剪影，既然不分版，这条没有消费者，删掉。
- **资产管线**：`assets/milu.png`（1254²，**无 alpha 满幅底**，底 `#fbfbfc`、墨 `#16181d`）→ `bun run icons` 生成 `assets/icon.iconset/*`（10 档）→ `electrobun.config.ts` 的 mac/linux/win 三处路径。**16px 档是验收门槛**。兜底（不是默认）：若重生成后 16px 仍不达标，只在**构建时**对 16/32 两档做一次笔画加粗，源文件仍是一份。
- **不许**：ASCII 狗、像素狗、终端方块拼的狗、给狗头加光标或命令行提示符、把狗放进 UI（空态、按钮、加载态）。
