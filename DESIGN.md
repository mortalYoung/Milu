---
version: beta
name: Partner-correspondence
description: Partner 数字员工桌面应用(书信对话方向,由 qiaomu-design Phase 2 四方向预览选定 B)。每轮对话像一封信:旧纸底色、衬线信笺气泡、邮戳时间戳、署名行;慢速、郑重、有人味。亮色纸感 + 经典气泡 IM,信息密度 2/10,动效强度 7/10。

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
- **composer**:底部 72px 条(上发丝线),居中 **60% 药丸**(44px 高,半径 22px,
  letter 纸面 + hairline,聚焦 seal);输入 Public Sans 14px "Type a message…";
  发送 = 34px seal 红圆,停止 = 纸面描边圆。
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
header 抬头不换行;输入区保持衬线 16px。深色模式不在本次范围。

## 9. Motion 哲学(动效强度 7/10)

- 缓动统一强化 ease-out:`cubic-bezier(0.23, 1, 0.32, 1)`;屏上移动用
  `cubic-bezier(0.77, 0, 0.175, 1)`。禁 ease-in。
- **签名交互 = "盖邮戳"**:agent 消息入场 `opacity 0 + scale(0.96) + rotate(0.4deg)`
  → 归位,240ms——信被轻轻盖在纸上。user 消息入场 200ms 淡入 + 上移 6px。
- 列表交错入场 stagger 40ms;退出比进入快(120ms vs 200ms)。
- 工作胶囊:圆点 1s 呼吸(opacity/scale),胶囊本体不动。
- 按钮按压 `:active { transform: scale(0.97) }`,160ms。
- 只动 transform/opacity;UI 动效 ≤300ms;键盘触发无动画。
- `prefers-reduced-motion: reduce` 时移除位移类动画,保留 opacity 过渡。
- hover 效果包在 `@media (hover: hover) and (pointer: fine)`。
