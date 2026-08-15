# Provider Quick Config（dsh 动态插件）

在 DeepSeek Harness Web GUI 的**发送键旁边**加一个 **+** 号按钮。点开后弹出面板，可以：

- 列出当前已配置的模型 Provider（`llm-pi-ai.providers.*` 路由），显示凭据是否已配置、每个 Provider 挂着哪些模型；
- **预设厂商一键添加**：智谱 GLM、MiniMax、OpenAI GPT、Anthropic Claude、本地模型 (Ollama) —— 端点 / 协议 / thinkingFormat / 模型列表都预填好；
- **模型选择器**：编辑表单里每个厂商有"快捷模型"chips（点一下选中/取消），也能手动加任意模型 id 并填 ctx/max —— 比如 MiniMax 想用 M3，点 M3 chip 即可，不需要碰 JSON；
- **本地模型自动加载**：选 Ollama 预设后自动请求 `GET /models` 把本机模型列表填进表单（也可在任何自定义路由上点"自动获取模型"）；
- **同一厂商加多个 key**：再点同一个厂商，key 自动排号（glm → glm2 → glm3…），显示名自动带"号N"；
- 或添加**自定义 OpenAI 兼容** Provider（自建网关 / 本地服务，手写 `api`、`baseURL`、`thinkingFormat`、模型列表）；
- 编辑 / 删除已有路由；填写或更新 API 密钥。

## 原理（零代码改动，纯配置文件热生效）

它没有自己另建一套配置，而是直接调用 harness 已有的两个 seam：

| 动作 | 写入位置 | 生效方式 |
|---|---|---|
| 添加 / 编辑 / 删除路由 | `$DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers` | settings 服务 `mutate` → 文件落盘 → `llm-pi-ai` 适配器 watcher 重注册，**下一次请求即生效** |
| 保存 / 更新 API 密钥 | `$DSH_HOME/.credentials.yaml`（0600） | credentials 服务 `set` → 文件被监听，热生效 |

插件只存 **凭据引用（环境变量名）**，密钥值只进 `.credentials.yaml`，不回传 GUI。

写路由时走 `settings.mutate`，它会经过 `llm-pi-ai` 命名空间的 schema + `assertServiceable` 校验：
配错的协议、空 baseURL、非法模型会被**在写入时就拒绝**并报错，不会把坏路由存进去。

## 安装 / 运行

1. 在本会话的 Run 卡片上允许授权（单勾即可，双勾允许后续版本自动运行）；
2. 刷新页面后，聊天输入框右侧（发送键旁）会出现 **+**；
3. 点 **+** → 添加 Provider → 选模板或自定义 → 填表单 → 保存。

> 也可同时打开 **设置 → 模型** 使用官方的完整模型页；本插件是输入框旁的快捷入口。

## 表单字段说明

| 字段 | 说明 |
|---|---|
| 路由 key | 唯一标识（`providers` 字典的 key），可随意起名，**保存后不可改**。同一厂商可建多条（如 glm1 / glm2） |
| 显示名 | 模型选择器里显示的名字，默认用 key |
| 凭据引用 | 环境变量名，如 `GLM_API_KEY`；请求时经 credentials 解析 |
| API 密钥 | 选填。填了 → 写入 `.credentials.yaml`；留空 → 不改动 / 靠环境变量 |
| API 协议 | 自定义路线三选一：`openai-completions` / `openai-responses` / `anthropic-messages` |
| BaseURL | 自定义路线必填 |
| thinkingFormat | `openai-completions` 的推理字段方言：`openai / deepseek / openrouter / together / zai / qwen / string-thinking / ant-ling`。自建端点猜不到就手写（如 MiniMax → `deepseek`，智谱 → `zai`） |
| 模型列表 | 自定义路线至少一项：`[{ "id": "…", "contextWindow": 131072, "maxTokens": 32768 }]` |

## 踩坑备忘（来自实际使用记录）

- **Ollama 也要填密钥**：OpenAI 兼容实现照样发 `Authorization` 头，占位非空即可（如 `local`）。
- **目录路线不用写模型**：只要 key + 密钥，模型/端点/协议继承 pi-ai 目录；自定义路线才手写模型。
- **`.credentials.yaml` 格式极严**：平铺 `名字: 值`，根必须是映射、值必须非空字符串、不能重复 key，任何一条都会启动失败。
- **⚠️ settings.yaml 不要用 YAML 锚点（`&anchor` / `*anchor`）**：settings 服务保存时按节点保留式合并，一旦保存替换了锚点定义者（如 `glm` 的 `models: &glm_models`），其余引用 `*glm_models` 的节点会变成悬空别名，整个文档序列化报 `Unresolved alias (the anchor must be set before the alias)`——插件和官方"设置→模型"页都会失败。多账号共用模型请写成显式列表（或让插件帮你展平）。已用锚点的文件可先让我/脚本展平再在 GUI 里保存。
- **环境变量是启动时快照**：进程启动后再 `export` 不生效，得重启；用本插件的密钥字段（写 `.credentials.yaml`）则不需要。
- **`apiKeyEnv` 配了但解析不到** → 直接 `MISSING_CREDENTIAL`，不会回退到环境里别的 key。
- 已发过请求的会话会保留日志里记录的模型；默认模型指向已删除的 Provider 时，选择器会要求重新选模型。

## 技术说明（给改插件的人）

- **Host 半**（`harness.handle` RPC，全部走 `ctx.settings` / `ctx.credentials` / `ctx.llm`）：
  - `providers.list` → 已配置路由 + 凭据状态 + pi-ai 目录 + 协议/推理方言枚举
  - `providers.save` / `providers.remove` → **ops 由 Client 构造、经 wire 传入**，Host 只转发给 `settings.mutate('llm-pi-ai', ops, revision)`
  - `providers.discover` → `ctx.llm.discoverModels('llm-pi-ai', { baseURL, api, apiKey })`
  - `credentials.set` / `credentials.unset`
- **⚠️ vm 沙箱 realm 陷阱**：动态 Host 代码跑在 `node:vm` 独立 realm 里，任何对象字面量都不是宿主 realm 的 plain object —— 传给校验 `isPlainObject` 的服务（如 `settings.mutate` / `settings.update`）会直接抛 `ops must be {op:'set'|'unset', path}`。**凡是传给这类服务的结构化数据，必须由 Client 侧构造、经 `host.call` 的 JSON wire 传入**（wire 解码后就是宿主 realm 对象）；Host 侧只做转发。返回结果则无所谓（guard 会自动把结果物化为宿主对象）。
- **Client 半**：`+` 按钮注册在 `conversation.input.right`（发送键左侧工具行），面板注册在 `conversation.input.overlay`（输入卡悬浮锚点），主题色全部走 `--dsw-*` 变量。
- 写操作带 `expectedRevision`，撞并发会 `SETTINGS_CONFLICT`，客户端自动重读重试一次。
