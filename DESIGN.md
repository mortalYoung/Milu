---
version: beta
name: Partner-correspondence
description: Partner 数字员工桌面应用(书信对话方向,由 qiaomu-design Phase 2 四方向预览选定 B)。每轮对话像一封信:旧纸底色、衬线信笺气泡、邮戳时间戳、署名行;慢速、郑重、有人味。亮色纸感 + 经典气泡 IM,信息密度 2/10,动效强度 7/10。三态主题(system/light/dark,默认 system),暗色为「暖夜纸」镜像。

colors:
  paper: "#f7f3ea"
  paper-deep: "#efe8d4"
  paper-hover: "#f0ead9"
  letter: "#fffdf8"
  ink: "#2a2620"
  ink-soft: "#4a4438"
  body-muted: "#6b6455"
  muted: "#8d8474"
  hairline: "#e2dccb"
  hairline-soft: "#eceae0"
  seal: "#b03a2e"
  seal-soft: "#e8d5d1"
  on-ink: "#fffdf8"

colors-dark:
  paper: "#141210"
  paper-deep: "#201b15"
  paper-hover: "#1a1612"
  letter: "#1f1b16"
  ink: "#f3edde"
  ink-soft: "#d8d0be"
  body-muted: "#b5ab96"
  muted: "#8f8574"
  hairline: "#343026"
  hairline-soft: "#262119"
  seal: "#d97a68"
  seal-soft: "#362420"
  on-ink: "#141210"

typography:
  serif-family: Newsreader
  sans-family: Public Sans
  mono-family: JetBrains Mono
  letter-bubble: 16px / 1.6, weight 400, Newsreader
  ui-text: 14px, weight 400-500, Public Sans
  ui-label: 11-12px, weight 500, Public Sans, uppercase, letter-spacing 0.6px
  signature: 12px, Public Sans, muted, right-aligned
  postmark: 11px, Public Sans, uppercase, letter-spacing 0.6px, seal red

rounded:
  bubble: 10px
  control: 8px
  input: 10px
  avatar: full

spacing:
  base: 4px
  list-row: 16px vertical
  page-gutter: 24px
  letter-pad: 14px horizontal / 12px vertical

components:
  bubble-user: bg ink, text paper, serif 16px/1.5, radius 10px, seal-red time below (10.5px)
  bubble-agent: bg letter, 1px hairline border, radius 10px, serif 16px/1.62, dashed seal postmark badge (58px circle, -12°), inline-code chips (paper-hover), seal-red signature line
  working-chip: ink pill + three paper dots (5px, staggered 1.2s pulse)
  composer: centered 60% pill (44px, radius 22px), letter bg + hairline, Public Sans 14px, 34px seal-red circular send
  conv-row: rounded 6px, gap 2px, hover paper-hover, selected paper-deep (整块底色, 无左侧竖线)
  conv-avatar: 34px circle with first-letter initial; ink fill for selected, paper+border otherwise
  conv-list-head: "Letters" serif 19px semibold + 26px ink circle add button
---

## 1. 视觉主题与氛围

Partner 是一个"数字员工"桌面应用:你选中一位同事(bob、eve、lee…),它会读文件、
跑命令、回消息。书信对话方向把"和数字员工交流"做成"和一位笔友通信":

- 整个窗口是一叠旧信纸:底色 `#f7f3ea`,信笺(气泡、输入框、面板)是 `#fffdf8` 的纸。
- 对话节奏刻意放慢:每轮 agent 回复像一封刚到的信——到达时有一个"盖下去"的
  入场动作,信尾带署名行。
- 无阴影、无渐变、无彩色噪声;层级靠纸面交替、发丝线、字距与衬线/无衬线的分工。
- 唯一的重音是封印红 `#b03a2e`(邮戳、时间、发送、focus),像信上的一枚火漆。
- 暗色下是同一叠纸在夜灯下:「夜纸」底色、奶油纸色文字,封印红提亮一档保持邮戳语义。

## 2. 色板与角色

| Token | 值 | 角色 |
|---|---|---|
| `paper` | `#f7f3ea` | 窗口底色(旧纸) |
| `letter` | `#fffdf8` | 信笺面:agent 气泡、输入框、弹窗(纸白) |
| `ink` | `#2a2620` | 正文、user 气泡底、工作胶囊底(暖墨,非纯黑) |
| `ink-soft` | `#4a4438` | 次级文字 |
| `body-muted` | `#6b6455` | 次要说明 |
| `muted` | `#8d8474` | meta 文字(时间、预览) |
| `hairline` | `#e2dccb` | 发丝线:边框、分隔(低语线,不用重边框) |
| `hairline-soft` | `#eceae0` | 更淡的分隔 |
| `seal` | `#b03a2e` | 唯一重音:发送按钮、邮戳时间、focus、选中徽标 |
| `paper-deep` | `#efe8d4` | 列表选中整块底色 |
| `paper-hover` | `#f0ead9` | hover 底色 |

原则:中性色一律带暖黄调(继承 Notion 暖中性策略);不用纯黑 `#000000`;
红只用于"邮戳"语义,不铺开。

**暗色(暖夜纸)**:暗色是亮色的严格镜像,每个 token 在 CSS 里是
`light-dark(亮, 暗)` 对,由 `color-scheme` 解析——系统模式零 JS、无闪烁,
设置页可强制 light/dark。镜像规则:纸面 → 夜纸(暗一档的暖炭)、墨 → 奶油纸色
(`ink` 同时是"实底印章"角色,暗色下变成最亮的纸面,user 气泡/选中 rail/工作胶囊
随之一并反转为浅底深字)、封印红提亮一档(`#d97a68`,保证 8.5-10.5px 邮戳小字在
夜纸上的对比度 ≥ 4.5:1)。全 token 映射见 frontmatter `colors-dark`。

## 3. 排版规则

- **两字体严格分工**(继承 Mintlify 两字体边界):Newsreader 只做阅读内容
  (气泡正文、空态),Public Sans 只做 UI(标签、meta、按钮),JetBrains Mono
  仅用于内联代码(如 `src/bun/core/agent.ts`)。
- 气泡正文:Newsreader 16px / 1.6(阅读行高,暖调缩放)。
- UI 文本:Public Sans 14px,字重 400–500,不用 600+。
- **大写标签是层级信号**(继承 Mintlify):分区头、时间、meta 用 Public Sans
  11–12px uppercase + letter-spacing 0.6px(微正字距,小字更可读——继承
  Notion badge micro-tracking)。
- 数字用 `font-variant-numeric: tabular-nums`。
- 禁斜体(强调用字重/颜色);禁纯黑;数据 UI 不用衬线,衬线只给阅读内容。

## 4. 组件样式

- **消息无头像**,60% 居中窄栏(信件流)。
- **bubble-user**:ink 实底 + paper 衬线文字 16px/1.5,半径 10px;下方 seal 红时间
  "10:41 AM"(10.5px, tracking 0.05em)。
- **bubble-agent(信)**:letter 纸面 + 1px hairline + 半径 10px,padding 17/18/12;
  右上角**虚线邮戳徽章**(58px 圆,seal 虚线,旋转 -12°,两行 "OCT 13" / "10:42",
  Public Sans 8.5px tracking 0.12em,纸底半透明);正文内反引号代码渲染为
  **inline-code chip**(paper-hover + hairline,半径 3px,mono 13px);底部右对齐
  **署名行** "— bob · 10:42 AM"(seal 红 12px, tracking 0.03em)。
- **working-chip**:ink 实底胶囊,内三个 5px 纸色圆点(1.2s 错峰呼吸)。
- **composer**:底部 60px 条(上发丝线),静态态只有一颗居中 **60% 药丸**(44px 高,
  半径 22px,letter 纸面 + hairline,聚焦 seal);药丸内右侧 context 环 14px 常驻,
  数字仅在 >60% 时显示,精确值在 meter 点击面板里;文本跨过输入超阈值时右侧出现
  34px seal 红圆发送(忙时=纸面描边停止圆);行首**只在真有后台任务时**才出现一颗
  28px 安静 toggle 圆钮(任务日志,带运行数徽章)。**没有常驻设置面板**:高频的
  per-partner 设置在药丸内右侧,而且**默认只占一枚图标** —— 静态态是 13px `Cpu`
  (muted);hover 出**自绘 tooltip**(150ms)报出「模型·档位」,不必展开也能看;
  结构写成 **icon | dropdown** 两段:`icon`(收起态 13px `Cpu`,展开态换成折叠
  chevron `❮`;常驻,自己的 tooltip 报值/提示"collapse",自己切换展开/收起)`|`(1px 发丝分隔)`dropdown`(`model·effort` + caret,
  点开 Models / Effort 两层菜单,就地写回,选完焦点回输入框)。收起态只有 icon
  (dropdown 被 `max-width: 0` 的滑槽裁掉,不可点、不进 Tab);点 icon 后 dropdown
  整体**向左滑出**(max-width 0 → 150px / 180ms ease-out,标签另有 26px 位移 +
  淡入;prefers-reduced-motion 关掉过渡),同时打开菜单;再点 icon 收起。
  低频的 sandbox 只在 partner 详情弹窗里改。
  输入 Public Sans 14px "Type a message…";textarea 聚焦不展开任何 meta。
- **partner 详情弹窗(per-partner 的家)**:820px 纸面 + hairline;左列 = 三张窗口卡
  (`· 9m`)+ Activity heatmap + Persona + Memory;右列 240px = **This session** 卡
  (本次会话的 token / cache share / TTFT / 吞吐,数值全带 tooltip 写清均值与样本)
  + **Status** 卡(Workspace / Storage / Size / **Runtime**:model·effort 与 sandbox
  两个可改选择器,字号跟随本卡的值 = mono 10.5px,配 hairline 8px 圆角 + 纸感
  chevron;Skills;MCP)。
  口径:低频的 per-partner 设置(sandbox)与全部 per-partner 指标住在这里或 partner
  自己的文件里,高频的 model·effort 另在输入药丸里有一枚 chip(同一个值两处入口);
  仪表盘只管全部 partner 的横向比较,不用来查单个 partner。
- **conv-row**:圆角 6px、行距 2px、hover `paper-hover`;**选中 = 整块 `paper-deep`
  底色**(禁止左侧竖线,规则 P-38)。
- **conv-avatar**:34px 圆 + **首字母**(serif 15px semibold);选中行 = ink 实底纸色字,
  其余 = letter 纸面 + hairline 描边。
- **目录头**:serif 19px semibold "Letters" + 26px ink 圆新建钮。
- **dialog/menu**:letter 纸面 + hairline 边框 + 半径 8px,无阴影;
  focus-visible 用 seal 红 ring + 2px offset(禁用浏览器默认蓝)。
- **outline(回答索引浮层,方向 A)**:右上角悬浮 letter 纸面卡(246px 宽,
  hairline 边框 + 半径 10px,无阴影),顶部 "Replies · N"(Public Sans 9px
  uppercase + seal 红 mono 计数),行间 hairline-soft 分隔。每行三层:
  右侧 seal 红 mono 时间 → 触发问题小字(Public Sans 9px uppercase
  tracking 0.12em,body-muted,单行截断)→ 回答首行(Newsreader 12.5px,
  单行截断)。hover = paper-hover + ink 2px 左缘;选中/最近一条 = paper-hover
  + seal 2px 左缘。**入场 = 卷轴式展开**(transform-origin top,scaleY
  0.94 → 1 + opacity,220ms ease-out),行内 25ms 级联;点击条目后目标气泡
  短暂 seal-soft "火漆闪烁"(1.1s 淡出)。`prefers-reduced-motion` 全部禁用。
- **trajectory drawer(密度格点,方向 B)**:右侧全高抽屉(≈74% 宽),三层结构:
  - **密度格点带**:每回合一格,格点高度 = 工具数(38/55/72%),颜色深浅 = token 用量(浅/中/深三级);
    用户提问 = seal 色里程碑标记;格点可点选(选中 = seal 实底,再点取消)。
  - **标签带**:每列与格点对齐,上层工具 chip(bash/read,seal-soft 的 msg),下层 6.5px 轮次说明
    (单行截断)。
  - **详情区**:无边框无底色,纯 hairline 分隔;默认全量回合按顺序列出,选中只显示该回合
    (回合头/时间/token、内容、工具 chips)。
  - 联动:点格点 → 聊天滚动定位 + 火漆闪烁;聊天滚动 → 当前可见回复所属回合格点高亮;
    消息气泡"Trajectory"入口 → 打开抽屉并聚焦该回合。入场 = 右侧滑入(220ms ease-out)。
- **settings(设置页,方向 B 档案柜)**:660×540 弹窗内,VSCode 设置式交互——
  搜索 + 衬线分类索引 + 标题/描述/控件行 + 修改标记 + 即时保存。左侧 168px 分类栏
  (General / Permission / Providers,Newsreader 13px,选中 = 整块
  `paper-hover` 底色,无左侧竖线;底部 serif "letters" 字标);右侧搜索框
  (paper 底 + hairline + 10px 圆角,seal focus,mono 计数 "N matches",Esc 清空);
  分类内容不套卡片:节标题 (serif 15px) + 行列表,行间 hairline 分隔线
  (divide-y);行 = 衬线标题 13px + Public Sans 描述 11px body-muted +
  控件右缘对齐一条基准线;**修改标记 = seal 圆点 + "modified" 10px 小字**(点,
  非竖条;默认值:theme=system、sandbox=workspace-write、path=~/.partner/、
  instr=AGENTS.md);搜索时命中词 seal 色高亮(行不加底色),结果按分类
  平铺,命中分类栏出现 seal 圆点;无命中显示 "No matching settings" 空态。
  Providers 是表格(Provider / Base URL / Models / 操作列,行间 hairline 分隔):
  key 只增删(换 key 删了重加);自定义 provider 行多一个 edit,点击在该行下方展开
  编辑区(id 只读,定义可改);底部 `+ Add provider` 点击展开新增区——**两步走**:
  先 APPLY 定义(custom… 表单:id / base URL / Models 表格 / Advanced 折叠
  [name / 默认 contextWindow / 默认 maxTokens],APPLY 后自动切回内置模式并选中
  刚添加的 provider),再填 key 点 ADD 完成添加;内置 = select + key + ADD。
  Esc / Back / Cancel / 再次点击收起。
  **例外声明**:设置行标题与分类用衬线,属「档案索引」阅读语境,突破 §3
  「数据 UI 不用衬线」——范围仅限 settings 模块。
- **TextField(控件)**:Kobalte headless 封装,`variant="compact"` 用于设置行
  (h-32px、paper 底、mono 12px、hairline 边框、10px 圆角、focus seal ring +
  paper-deep 底),`default` 用于模态表单(sans、letter 底)。输入值一律 mono
  (路径/API key),选项值(Select)sans。
- **自定义滚动条**:6px 细窄,hairline thumb。

## 5. 布局原则

- 左侧 64px 图标栏(纸面;active = ink 实底纸色图标,40px 圆角 10;品牌 = 30px
  ink 圆内 serif "P")→ 对话列表(约 240px)→ 聊天窗。
- 聊天窗 header 72px,上下发丝线,居中 "bob · Design partner"(name serif 18px
  semibold,分隔 "·" 与 role 为 Public Sans 13px body-muted)。
- 消息流 = **60% 居中窄栏**,上下留白大(信间距 24px,信息密度 2/10)。
- 日期分隔 "TUESDAY · OCT 13":Public Sans 10px tracking 0.18em + 两侧 44px 发丝线。
- 一个视觉焦点:正在到来的信(工作胶囊 + 盖邮戳入场动画)。

## 6. 深度层级

无投影。层级靠:纸面交替(paper → letter)、发丝线、底色深浅(paper-hover →
paper-deep)、字重/字距。弹窗与菜单靠纸面 + 边框浮起,不用阴影。

## 7. Do's / Don'ts

**Do**:暖纸色板;衬线读、无衬线用、mono 只给代码;信封抬头;署名行;
邮戳时间;大写标签;整块底色选中;seal 红只在邮戳语义;入场用"盖下"动作。

**Don't**:纯黑、渐变、阴影堆叠、玻璃拟态、AI 紫蓝、斜体、左侧竖线装饰、
Inter/Roboto/Arial 作为 UI 字体、等宽字体堆砌、600+ 字重铺排、红色大面积铺开。

## 8. 响应式

桌面优先(960×700 窗口)。宽度收窄时:列表栏可收起;气泡 max-width 72% → 85%;
header 抬头不换行;输入区保持衬线 16px。

主题三态:默认跟随系统(`color-scheme: light dark`,暗色 token 立即生效,无启动闪烁);
设置页 General → Theme 可强制 light/dark(写 settings.json 的 `theme` 字段,App 根组件
应用到 `<html data-theme>`,切换带 200ms 颜色过渡)。暗色为暖夜纸镜像(§2),
无需任何组件级暗色规则。

## 9. Motion 哲学(动效强度 7/10)

- 缓动统一强化 ease-out:`cubic-bezier(0.23, 1, 0.32, 1)`;屏上移动用
  `cubic-bezier(0.77, 0, 0.175, 1)`。禁 ease-in。
- **签名交互 = "盖邮戳"**:agent 消息入场 `opacity 0 + scale(0.96) + rotate(0.4deg)`
  → 归位,240ms——信被轻轻盖在纸上。user 消息入场 200ms 淡入 + 上移 6px。
- 列表交错入场 stagger 40ms;退出比进入快(120ms vs 200ms)。
- 工作胶囊:圆点 1s 呼吸(opacity/scale),胶囊本体不动。
- 按钮按压 `:active { transform: scale(0.97) }`,160ms。
- **run-settings 面板**入场 = 上移 6px + 淡入 180ms 强化 ease-out;
  `prefers-reduced-motion` 只留淡入(位移禁用)。
- 只动 transform/opacity;UI 动效 ≤300ms;键盘触发无动画。
- 主题切换 = 200ms 纯颜色过渡(background/border/color/fill/stroke,强化 ease-out),
  仅主题变化期间由 `.theme-flip` 临时挂载,不干扰日常交互;reduced-motion 下无过渡。
- `prefers-reduced-motion: reduce` 时移除位移类动画,保留 opacity 过渡。
- hover 效果包在 `@media (hover: hover) and (pointer: fine)`。

## 10. Dashboard(由 Phase 2 四方向预览选定)

第三个全窗口视图(rail: Chat / Skills / Dashboard / Settings),与 Skills 同族:
`flex-1 overflow-y-auto` + `px-6 py-6` 满宽内容列(不是 §5 的 60% 信流栏——那是对话列的解剖,
视图族沿用 Skills 的解剖)。

### 视觉主题与氛围

**一本摊开的往来账簿**:先看本期合计,再往下翻到每封信那一行。
全页**无衬线数据**(§3 的数据 UI 规则在这里被推到极端:A 方向连视图标题之外一个衬线都没有)、
无卡片、无阴影,只用横贯满宽的三段条带 + 发丝线分行。唯一重音仍是封印红,且只出现在
**量尺填充**与**曲线柱**上——红在这页的语义是"量",不是"警告"。

**视角例外声明**:视图标题 `Dashboard` 用 Newsreader 20px semibold(与 Skills 的 `Skills` 一致),
属"视图族标题"语境;表格与数字一律 Public Sans / JetBrains Mono,不破 §3。

### 结构(先综合、后个体)

| 段 | 内容 | 编码 |
|---|---|---|
| 抬头的 meta 行 | letters · forks · unread · since | mono 9px uppercase |
| **合计栏** | Turns / Fresh / Cache / TTFT / Memory 五格,上下 2px ink 重规线 | 数字 mono 20px weight 500 tracking −0.02em |
| **每日柱列** | 最近 7 天 turns | 柱高线性,**不做高度动画**(只动 transform/opacity 的规则优先) |
| **逐信表** | name+last written / fresh 量尺 / turns / TTFT / memory / last run | 量尺带 4 格刻度线,填充 28% 透明度的 seal |

### 数据纪律(本模块特有,优先级高于通用规则)

- **量纲必须与真实语义一致**:"用量"一律用 **fresh tokens**(input + output + cacheWrite)。
  本机实测 total tokens 的 **99.1% 是 prompt-cache 重读**,画 total 等于画缓存;cache 只以
  `<百分比>% of <total>` 的形式出现在注脚里。禁止把 lifetime 平均(如 tokens/s)冒充实时指标。
- **窗口文案必须从常量或数据推导**:曲线窗口 = `DASHBOARD_WINDOW_DAYS`(7),标签由它生成;
  "since" 由第一条有记录的日期推导。禁止手写 "last 12 weeks" 这类字符串。
- **合计必须等于各行之和**:逐信 turns / fresh / tools 与合计同源(同一次 activity 扫描),
  不允许两个来源各算一遍。
- 数据源只读每封信自己的文件(`runtime-stats.json`、memory 文件体积、`runs.jsonl` 尾部)
  + 一次 activity 扫描;实测 6 封信 282ms。

### 签名交互(全页仅一个)

**悬停/聚焦一行信 → 每日柱列改画这封信的当日起伏**,其余列降噪到 28% 透明度,
该行名转 seal 红;移开恢复全量。目的是让"这封信最近动过吗"这个问题的答案落在同一根轴上。
包在 `(hover: hover) and (pointer: fine)` 内;`tabIndex=0` + `focus-visible` 让键盘同样可用;
`onFocus/onBlur` 与指针事件并存,不靠 hover 独占。

### Do's / Don'ts

- Do:合计栏用 2px ink 重规线夹住(账簿的分期总账感);刻度线画在量尺轨道上。
- Don't:不要给柱高/宽度加 transition(非 GPU 属性);不要用左侧竖线标记聚焦行(P-38);
  不要给这页加模型轨迹那种彩色密度格点(红只表示"量")。

### DNA(从 references/design-systems/stripe 偷的具体值)

1. 表格里的数字一律 `font-variant-numeric: tabular-nums`(Stripe 对账目数字用 `tnum`);
2. "密集数据 + 宽松外壳":数据行 py-2 / 字号 9–20px 密集小端,段与段之间 mt-5/mt-6 拉开;
3. 圆角保守:单元格不做药丸,量尺/柱/格一律直角或 1–2px;
4. 大数字不靠字重吼:20px 只用 weight 500 + 负字距(−0.02em),靠等宽与尺寸建层级;
5. 字阶密集在小端:9 / 9.5 / 10.5 / 11 / 12 / 13.5 / 20。

### Motion

动效强度 2/10:全页唯一过渡是行底色 `120ms`(background-color)。柱高、量尺宽度一律**瞬变**。
`prefers-reduced-motion: reduce` 时移除行底色过渡。

### 日历 heatmap(与 §4 的 partner 面板共用组件与量纲)

- **组件复用**:`ActivityHeatmap`(partner 详情面板同一个)。它只吃一串**周一对齐**的连续日
  序列,月份尺按实际列数排布(所以传入的周数可以变,尺子不会错位);partner 面板传
  37 周,本页传 52 周 + 当前不完整的一周 = 53 列。
- **窗口派生**:后端 `DASHBOARD_HEATMAP_WEEKS` 给出周一对齐的密集序列(到 today),
  前端的 `HEATMAP_WEEKS = 52` 只用于**生成标签**(`Math.round(52 / 4.345) = "12 months"`),
  从不手写。两者必须满足 前端周数 ≤ 后端 horizon。
- **量纲**:沿用 partner 面板的 `turns + freshTokens / 3000`,四档 [100, 300, 900]。它**不含
  cache**(P-60),所以本页三个时间物件的量纲是:曲线 = turns;日历 = turns + fresh/3000;
  表格量尺 = fresh。每一处都在标签或图例里写明,不靠读者猜。
- **不变量**:序列必须从周一开始、逐日密集(空格子也要占位),否则列会错位。后端用
  `setDate(+1)` 推进(跨夏令时安全),不用 `+86400000` 累加。
- **窄窗**:日历固定 53×12px ≈ 636px,外层 `overflow-x-auto` 兜底,避免把页面撑出横向滚动。
