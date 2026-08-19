# DSH 插件开发完整指南

> 本项目 DeepSeek-ai/deepseek-harness 插件一次性开发的真实流程。基于 [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams/blob/main/skills/dsh-plugin-development/SKILL.md) + [deepseek-ai/deepseek-harness 官方 publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) 摘要。
>
> **本文档面向**：要给本项目打补丁 / 改完想立刻看效果的开发者。
>
> **关键事实**：DSH GUI 加载的代码**不是 src/**，是 `~/.dsh/profiles/<name>/node_modules/<your-plugin>/lib/` 或者 `src/`（取决于你装的方式）。**改 src/ 不一定生效**。

---

## 1. 项目结构

本项目同时存在两份**等价但用途不同**的插件形态：

```
DeepSeek-Harness-provider/
├── dsh-provider-quick-config/      # 正式 npm 包（dsh.bundle + dsh.client）
│   ├── src/
│   │   ├── host.js                 # Host 半：Cordis 插件，运行在 host 进程 + webserver
│   │   └── client.js               # Client 半：浏览器模块，dsh.client 入口
│   ├── package.json                # 声明 dsh.bundle.patch + dsh.client
│   ├── cordis.patch.yml            # bundle 层配置
│   └── *.tgz                       # 打包产物（npm pack 出来）
│
└── plugin/                          # 动态插件（cordis_define(code.host, code.client)）
    ├── host.js
    ├── client.js
    └── manifest.json                # 自维护备份清单（DSH 不读）
```

**两种形态的差异**：

| 项 | 正式包（dsh-provider-quick-config） | 动态插件（plugin/） |
|---|---|---|
| 包入口 | `package.json` 的 `main` / `exports` | `cordis_define` 调用 |
| Profile 装载 | `dsh plugin --profile web add <spec>` | 不直接被 profile 加载（除非手写 cordis_define 流程） |
| HMR | `dsh.client.hmr` 监听 stat + `rev` 标识 | 动态加载 |
| .tgz 装入 profile | 推荐 | 不推荐（需要额外的动态加载器） |
| 浏览器模块 | `lib/client.js` 或 `src/client.js` | `code.client` 字符串 |

**经验**：平时**只用 `dsh-provider-quick-config/`** —— 这是官方推荐路径；`plugin/` 是历史/兼容 fallback。

---

## 2. 完整 package.json 模板

参考官方 `packages/host/webserver` + `packages/client/ui-message-feedback` + `packages/client/ui-conversation` 三件套。

### 2.1 双面 bundle（host + client）

```json
{
  "name": "dsh-provider-quick-config",
  "version": "0.5.5",
  "private": true,
  "type": "commonjs",
  "main": "src/host.js",
  "files": ["src", "cordis.patch.yml"],
  "exports": {
    ".": "./src/host.js",
    "./client": "./src/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-api-remotes"
      ],
      "immediately": false
    }
  }
}
```

**字段说明**：
- `type: "commonjs"` —— host.js / client.js 都用 `var module = { exports: {} }` 模式
- `main: "src/host.js"` —— 直接用源码（不构建也行）
- `exports["./client"]` —— 浏览器模块 loader 通过这个路径加载
- `dsh.bundle.patch` —— 指向 `cordis.patch.yml`
- `dsh.client.inject` —— **信息性元数据**（不决定 activation 顺序） —— 真实依赖在 client.js 头部 `factory(require)` 里通过 `require(...)` 访问
- `dsh.client.immediately` —— 启动关键入口才用，**普通插件不要开**

### 2.2 host-only（无 Web UI）

去掉 `client` 字段 + `exports["./client"]`：

```json
{
  "name": "dsh-fs-tools",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "exports": {
    ".": "./lib/index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "cordis.patch.yml"
    }
  }
}
```

### 2.3 client-only（无 host 逻辑）

```json
{
  "name": "dsh-message-feedback",
  "type": "module",
  "exports": {
    "./client": "./lib/client.js"
  },
  "files": ["lib", "cordis.patch.yml"],
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime"]
    }
  }
}
```

---

## 3. cordis.patch.yml 模板

顶层必须是数组。每条 patch row 的 `id` 是配置树里的稳定身份，`name` 是 Node 可解析的包名 / 路径。

```yaml
- insert:
    - id: provider-quick-config
      name: dsh-provider-quick-config
      config: {}
```

**生效顺序**（后者覆盖前者）：
1. profile bundles 按 `dsh.profile.bundles` 依次叠加
2. profile `cordis.patch.yml`
3. `$DSH_HOME/cordis.patch.yml`
4. 命令行 `--patch`

---

## 4. Host 半写法（host.js）

### 4.1 最小函数插件

```js
'use strict'

module.exports = {
  name: 'dsh-provider-quick-config',
  inject: ['timer', 'webServer'],  // 硬依赖；Cordis 会等待这些 service ready
  apply(ctx) {
    // 一次性写逻辑
    ctx.interval(() => doStuff(), 60000)
    // 注册路由
    const server = ctx.get('webServer')
    if (server && typeof server.register === 'function') {
      const disposer = server.register({
        kind: 'exact',  // 'exact' | 'prefix'
        path: '/plugins/my-plugin/foo',
        handler: async (req, res) => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        },
      })
      // 用 ctx.effect 收尾
      ctx.effect(() => disposer, 'my-plugin:foo-route')
    }
  },
}
```

**关键点**：
- **不要在 apply 里抢跑兄弟 provider** —— 用 `ctx.inject([...], childCtx => ...)` 等待
- **所有资源都要有 disposer** —— route、registry、timer、React root、DOM、socket、临时 service
- **不能用 `process.cwd()` 默认值** —— 路径必须显式配置

### 4.2 Service 插件

```js
const { Service } = require('@deepseek-ai/cordis')

class MyService extends Service {
  constructor(ctx, config) {
    super(ctx, 'myService')
  }
  async [Service.init]() {
    // 异步初始化
  }
}

module.exports = {
  name: 'dsh-my-service',
  inject: ['logger'],
  apply(ctx, config) {
    ctx.plugin(MyService, config)
  },
}
```

### 4.3 Schema 验证

```js
const { z } = require('@deepseek-ai/schemastery')  // 注意是 schemastery，不是 zod

module.exports = {
  name: 'my-plugin',
  Config: z.object({
    enabled: z.boolean().default(true),
    interval: z.number().default(60),
  }),
  apply(ctx, config) {
    // config.enabled / config.interval 自动应用 schema 默认值
  },
}
```

---

## 5. Client 半写法（client.js）

### 5.1 最小入口

```js
window.__ModuleLoader__.load({
  id: 'dsh-my-plugin',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    // 这里写所有 React 组件 + hooks
    // 用 ctx.slots / ctx.connection / ctx.theme 等等平台服务

    // 导出 host 调用的注册入口
    module.exports = {
      apply(ctx) {
        // ctx.slots.inject('conversation.input.right', () =>
        //   ctx.slots.register({ name: 'conversation.input.right', id: 'my-button', order: 0 },
        //     () => React.createElement(MyButton)))
      },
    }
  },
})
```

### 5.2 Slot 注册四步契约

1. **声明**：从 `ui-conversation` 拉入 SlotMap 类型
2. **认领**：父 entry 的 `children` 表声明子 slot
3. **注册**：
   ```js
   ctx.slots.inject('conversation.input.right', () =>
     ctx.slots.register({
       name: 'conversation.input.right',  // 跟声明对齐
       id: 'my-button',
       order: 0,
     }, MyButtonComponent))
   ```
4. **渲染**：owner 用 `renderSlot(props, 'slot-name')`

**常见 slot 名**（来自 `ui-conversation/src/client/contract/slots.ts`）：
- `conversation.session.header.actions` / `.utilities`
- `conversation.view`
- `conversation.chat.node` / `.commandview` / `.assistant-actions` / `.turnTail`
- `conversation.input.dock` / `.composer.dock` / `.composer.bar`
- `conversation.input.left` / `.right` / `.plan` / `.model`
- `shell.overlay`（全局浮层）

### 5.3 client import 纯度

浏览器模块表只回答**正式版平台 seed 模块 + 明确豁免**：

- ✅ 允许：`React`、`Cordis`、`slots`、`web-react`、`primitives`、`attachment`、`schema-form`
- ❌ 禁止：跨插件**值 import**（纯类型 OK）
- ⚠️ 临时豁免：`@deepseek-ai/dsh-client-runtime/client`

**协作必须走 Cordis service / remote / slot** —— 跨插件值 import 会让构建期纯度门或运行时 `require()` 失败。

---

## 6. HMR 与生效路径（最关键）

DSH 平台加载你插件的**两个时点**：

| 维度 | 触发条件 | 行为 |
|---|---|---|
| Profile 加载 | 启动 / `dsh plugin ...` 后 | 读 `~/.dsh/profiles/<name>/node_modules/<plugin>/package.json` → 查 `dsh.bundle.patch` / `dsh.client` |
| 代码变更 | 文件变化 | **host**: stat 检测 → rev → SSE 通知 browser → `dispose/reload` fiber；**client**: 同上，但触发条件仅 `lib/client.js` 变化 |

### 6.1 你改 src/host.js 后

1. 编辑 `src/host.js`
2. **DSH 平台 stat 检测文件变化**
3. **触发 reapply** —— 新的 cordis fiber 重新加载
4. **不需要重启 DSH 进程** —— HMR 会自动完成

⚠️ **坑**：如果 `inject` 数组变了、`dsh` manifest 字段变了、`patch.yml` 改了，**HMR 不会处理** —— 必须重启 DSH。

### 6.2 你改 src/client.js 后

1. 编辑 `src/client.js`
2. **DSH 平台 stat 检测 `src/client.js`**
3. **browser fiber 自动 dispose + reload**
4. 浏览器**无需刷新** —— 自动重渲染

### 6.3 验证改完生效

```bash
# 1. 确认 DSH 实际加载的代码（不是 src/ 本地）
curl -s "http://127.0.0.1:3080/plugins/dsh-<your-plugin>/client.js?rev=<hash>" | head -20

# 2. 看 DSH 进程状态
lsof -i:3080

# 3. profile 里的真实副本
cat ~/.dsh/profiles/<name>/node_modules/<your-plugin>/package.json
```

⚠️ **DSH 加载的是 profile 里的副本**，不是 src/。如果发现不一致，那是 HMR 没有 wire 起来。

---

## 7. 完整工作流（开发 → 提交 → 部署）

### 7.1 本地开发循环

```bash
# 1. 改 src/
$EDITOR src/host.js src/client.js

# 2. 看 DSH 是否 HMR 自动 reload
# 看 DSH 终端日志："rebuilt" / "client.js changed"

# 3. 不行？手动验证：
curl -s "http://127.0.0.1:3080/plugins/dsh-<your-plugin>/client.js?rev=$HASH" | grep "<your-feature>"

# 4. 浏览器刷新（保险起见）
# 但通常 HMR 自动处理
```

### 7.2 不需要 .tgz 装包的情况

**只有当你**：
- 改了 `dsh.bundle` / `dsh.client` 字段
- 改了 `cordis.patch.yml`
- 改了 `package.json` 的 `exports` / `files`

才需要：
```bash
# 重打包
npm pack

# 装入 profile
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add \
  file:/Users/a1/Workspace/<repo>/<plugin>/<plugin>-0.5.5.tgz

# 重启 DSH
```

### 7.3 提交检查清单

`SKILL.md` §9 完成标准：

- [ ] 运行面最小（host-only / client-only / 双面）
- [ ] manifest、exports、patch 与产物一致
- [ ] 必需 `inject` 和可选 service 边界清楚
- [ ] route、registry、timer、watcher、DOM、React root 都有 disposer
- [ ] `pnpm typecheck` + `pnpm build` + `pnpm test` 通过
- [ ] 真实组合验证（Linux/Mac）：从零 profile 安装 + `--dump-config` + 真实 UI 验证
- [ ] README 安装命令与实际分发形态一致

---

## 8. 常见坑（实战教训）

### 8.1 改 src/ 但 DSH 加载的是旧版

**症状**：浏览器调试看到 `client.js` rev 是某个 hash；你搜 `native-screenshot` 找不到。

**原因**：DSH 装的 .tgz 里就有 client.js。tsdown 没有 watch —— 你改了 src/，**但 host 加载的那个 lib/client.js 或 src/client.js 文件没更新**。

**解决**：
- 启动 `tsdown --watch` 持续重写 lib/client.js
- 或直接编辑 `~/.dsh/profiles/<name>/node_modules/<your-plugin>/src/client.js`（**不推荐**，但能让你立刻看到效果）

### 8.2 `window.__ModuleLoader__.load` 没生效

**症状**：dev tools console 看到 `WARNING: client bundle has no __ModuleLoader__.load` 之类。

**原因**：构建时 `tsdown` 把 `__ModuleLoader__.load` 包到了 `lib/client.js` —— 但 src/client.js 直接 export 不被 loader 识别。

**解决**：
- 用 `tsdown` 构建纯 lib/client.js
- 或直接在 src 顶部手写 `window.__ModuleLoader__.load({...})`（这就是本项目在做的）

### 8.3 `getDisplayMedia` 在 macOS 焦点跳走

**症状**：用 browser API 截屏 → 截到剪映而不是 DSH 页面。

**原因**：macOS 选择器关闭后焦点不回到 DSH。

**解决**：用 macOS 原生 `screencapture` 命令（不需要浏览器权限）：

```js
// host.js — 通过 cordis subprocess service
const subp = ctx.get('subprocess')
subp.spawn({
  argv: ['screencapture', '-i', '/target/path.png'],
  cwd: cwd,
  stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
  graceMs: 60000,
})
```

### 8.4 plugin/ 目录是死代码

**症状**：编辑 `plugin/host.js` 后没生效。

**原因**：现代 DSH 不直接读 `plugin/`。`plugin/` 只是历史 / 备份形态。

**解决**：在 `dsh-provider-quick-config/`（或新建你的正式包）里改。

### 8.5 npm pack 失败（沙箱权限）

**症状**：`npm pack` 报 `sudo chown -R 501:20 "/Users/a1/.npm"`。

**解决**：手动打 tar：
```bash
mkdir -p /tmp/pkg && cp package.json cordis.patch.yml /tmp/pkg/ && cp -r src /tmp/pkg/
sed -i '' 's/"0.5.4"/"0.5.5"/' /tmp/pkg/package.json
cd /tmp/pkg && tar czf /tmp/<name>-0.5.5.tgz *
```

---

## 9. 验证矩阵（CI / 本地）

```sh
# 静态
pnpm typecheck         # 必须 0 错误
node --check src/host.js src/client.js  # 备用

# 单元（host）
node -e "require('./src/host.js')"  # 必须能 require

# 集成（必需）
dsh plugin --profile web add file:./<plugin>.tgz
dsh --profile web --dump-config | grep "<your-plugin-id>"

# 真实 GUI
# 1. 打开 http://127.0.0.1:3080
# 2. 看侧栏 / 输入框 / 媒体面板 出现你的 feature
# 3. 触发功能 → 验证不抛错
# 4. 浏览器 dev tools → Console / Network 看 host 路由被调
```

---

## 10. 速查表

| 任务 | 命令 |
|---|---|
| 改 host 代码 | 编辑 `src/host.js`，DSH 自动 HMR |
| 改 client 代码 | 编辑 `src/client.js`，DSH 自动 HMR |
| 改 cordis.patch.yml | 重打 .tgz + `dsh plugin add` + 重启 |
| 改 package.json manifest | 重打 .tgz + `dsh plugin add` + 重启 |
| 验证路由 | `curl -i http://127.0.0.1:3080/plugins/<your-plugin>/<route>` |
| 看 DSH 实际加载哪个文件 | `curl -s "http://127.0.0.1:3080/plugins/dsh-<your-plugin>/client.js?rev=<hash>"` |
| 看哪些插件在 profile | `cat ~/.dsh/profiles/<name>/package.json` |
| 重启 DSH | `kill <PID>; dsh --profile web`（沙箱外手动） |

---

## 11. 参考链接

- [NanmiCoder/dsh-agent-teams SKILL.md](https://github.com/NanmiCoder/dsh-agent-teams/blob/main/skills/dsh-plugin-development/SKILL.md) — **插件开发最权威指南**
- [deepseek-ai/deepseek-harness publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — 官方包发布
- [deepseek-ai/deepseek-harness docs/user/develop/basic/config.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) — 配置层
- [deepseek-ai/deepseek-harness docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md) — 中文版
- [lo2589/deepseek-harness-provider](https://github.com/lo2589/deepseek-harness-provider) — **本项目 GitHub 镜像**（含 README + 完整 changelog）
- [orcarouter.ai DSH Plugins Guide](https://www.orcarouter.ai/blog/deepseek-harness-plugins) — 第三方视角
- [dsh-client-hmr](https://www.npmjs.com/package/@deepseek-ai/dsh-client-hmr) — 客户端 HMR 实现

---

## 12. 本项目实战 checklist

针对 `dsh-provider-quick-config`：

- [ ] `src/host.js` —— Cordis 函数插件，注入 `['timer', 'webServer']`
- [ ] `src/client.js` —— `window.__ModuleLoader__.load({ id, factory })` 形态
- [ ] `cordis.patch.yml` —— 顶层数组 + 模块加载 row
- [ ] `package.json` —— `dsh.bundle.patch` + `dsh.client.inject`
- [ ] HMR 验证：改 src/ → 等 1s → 浏览器自动重渲染
- [ ] 真实 GUI 验证：点截图按钮 → 落盘到 `<session cwd>/.screenshots/` → 媒体展示台显示
- [ ] commit message 写明：commit hash + 触发文件 + 验证步骤
- [ ] **永远不要写「测试通过」除非跑了真测试**（Playwright + 真实 DSH 平台）

---

**最后**：本项目（DeepSeek-Harness-provider）的所有修复**必须**通过 Playwright + 真 DSH 平台验证，**不要**只跑 mock 测试就声称通过。
