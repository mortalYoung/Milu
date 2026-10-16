# Milu — rebuild

Greenfield 重建分支。**没有历史**，一个 commit 起家。

v1 完整保留在两处，随时可读：

- 分支 `master`（303 commits，已推到 origin）
- tag `archive/v1`

## 已定的四件事

1. **单用户。** 不做多租户，不做认证体系。
2. **一条传输：WebSocket。** 桌面端不保留 Electrobun RPC，web 与 desktop 同构。
   RPC 语义保留（带 `id` 的 request/response 帧 + 无 `id` 的 event 帧），
   但由自己的协议层实现，不用 `BrowserView.defineRPC` / `Electroview`。
3. **桌面 = 连本机回环的 web 客户端。** 壳加载 `http://127.0.0.1:<port>/`，
   视图连 `ws://127.0.0.1:<port>/ws`。Electrobun 只剩开窗口、装菜单、记 frame。
   启动时生成随机 token 塞进窗口 URL，握手校验 —— 回环端口对本机其他进程是敞开的。
4. **功能优先，不强制测试随行。** 人工验证。搬迁提交与行为改动提交尽量分开。

## 目标形态

```
packages/protocol/    wire + DTO，零运行时依赖
packages/backend/     零 electrobun、零 window 概念
  src/platform/       container, lifecycle(Disposable), event(Emitter/Event), log, config, storage
  src/services/       一个关注点一个服务，singleton 于容器
  src/features/       领域编排
  src/sandbox/        backends/{seatbelt,docker}.ts   ← 接口照抄 v1 的 SandboxBackend
packages/app/         共享视图层（React），web 与 desktop 共用
apps/server/          Bun.serve：HTTP + WS，唯一进程入口
apps/desktop/         Electrobun 壳 —— 唯一 import electrobun 的地方
apps/web/             Vite 入口
```

## 从 v1 取东西

```bash
git checkout archive/v1 -- <path>     # 取单个文件/目录

# 常用：
git checkout archive/v1 -- assets/             # 品牌：milu.png + icon.iconset + gen-icons.sh
git checkout archive/v1 -- .agents/ skills-lock.json   # qiaomu-design 技能（全局无副本）
```

## 不该搬的形状

- `src/bun/index.ts`（2957 行组合根）—— 要逃离的就是它。
- 模块级可变单例。新容器里 singleton 是「容器内唯一」，不是 `export const`。
- `viewPartner` / `appFocused` / `railView` 住在后端 —— 改成显式的 presence 契约。
- `settingsCache ?? startupSettings` 双源。

## 第一天就要回答的安全问题

v1 的 `permission/manager.ts` 只在 darwin 上挂 seatbelt，其他平台后端链为空：

```ts
const defaultChain = platform === "darwin" ? [seatbeltBackend] : [];
```

服务器上这等于**没有沙箱**，权限层静默降级。服务端隔离后端优先于一切重构工作。
