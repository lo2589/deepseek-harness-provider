# 给 DeepSeek Harness 接上别的模型：零代码配置 + 一个快捷插件

> DeepSeek Harness（dsh）默认只接 DeepSeek 官方模型。想用 GLM、MiniMax、GPT、Claude，甚至本机 Ollama？其实**不用改任何源码**——两个配置文件，热生效，重启都不需要。

---

## 先说结论：它比你想的简单

dsh 的模型路由走一个叫 `llm-pi-ai` 的适配器。这个适配器**默认挂载，但一条路线都没有**——它是"装着的，但不干活"。真正的开关是 `~/.dsh/settings.yaml` 里的一段配置：**只要 `llm-pi-ai.providers` 里出现路线，它就注册；而且每次请求都会重新解析配置，改完文件下一次调用就生效，不用重启。**

所以你接新模型只需要动两个文件：

```
~/.dsh/settings.yaml         路线定义（只写变量名，不写密钥 → 可以贴、可以提交）
~/.dsh/.credentials.yaml     密钥本体（0600，被监听，改完热生效）
```

## 三个核心概念

### 1. `apiKeyEnv` 是引用，不是值

配置文件里永远只写环境变量名（如 `GLM_API_KEY`），真正的密钥放在 `.credentials.yaml` 里：

```yaml
# ~/.dsh/.credentials.yaml
GLM_API_KEY: sk-xxxxxxxx
MINIMAX_API_KEY: sk-yyyyyyyy
OLLAMA_API_KEY: local          # 本地模型也要给个占位，见下文坑②
```

凭据有四层优先级（高到低）：进程环境变量 → `.credentials.yaml` → 启动目录 `.env` → `~/.dsh/.env`。

### 2. 三种路线写法

**① 目录路线**——pi-ai 认识这个厂商，端点/协议/模型全继承，只补密钥引用：

```yaml
llm-pi-ai:
  providers:
    deepseek:
      apiKeyEnv: DEEPSEEK_API_KEY
```

**② 目录路线 + 覆盖**——只改想改的字段：

```yaml
    anthropic:
      apiKeyEnv: ANTHROPIC_API_KEY
      models:                       # 写了 models 就是替换整个目录
        - id: claude-sonnet-4-5
          contextWindow: 200000
```

**③ 手写路线**——pi-ai 不认识，整个自己声明。任何 OpenAI 兼容网关都走这条：

```yaml
    minimax:
      displayName: MiniMax
      apiKeyEnv: MINIMAX_API_KEY
      api: openai-completions      # 三选一：openai-completions / openai-responses / anthropic-messages
      baseURL: https://api.minimaxi.com/v1
      compat:
        thinkingFormat: deepseek   # 端点 URL 认不出来时，手动指定推理字段方言
      models:
        - id: MiniMax-M2.5
          contextWindow: 245760
          maxTokens: 32768
```

### 3. 路线 key 是任意的 → 一个厂商可以开多个账号

四个智谱号 = 四条路线共用一个端点，只有 `apiKeyEnv` 不同，模型列表用 YAML 锚点共享（**但锚点有坑，见坑③**）：

```yaml
    glm:
      displayName: 智谱 GLM · 号1
      apiKeyEnv: GLM_API_KEY
      api: openai-completions
      baseURL: https://open.bigmodel.cn/api/paas/v4
      compat: { thinkingFormat: zai }
    glm2:
      apiKeyEnv: GLM2_API_KEY
      # 其余同 glm
```

在模型选择器里，它们就是四个独立条目——选号 = 选模型。

## 实测出来的五个坑

1. **`thinkingFormat` 猜不到就得手写**。pi-ai 按 URL 认推理方言，自建端点认不出来。可用的八种：`openai / deepseek / openrouter / together / zai / qwen / string-thinking / ant-ling`。MiniMax 的思维链在 `reasoning_content` 里 → 填 `deepseek`（这是字段形状的名字，不是厂商归属）；智谱 → `zai`。

2. **Ollama 不需要密钥，但必须给一个**。pi-ai 的 OpenAI 兼容实现照样发 `Authorization` 头，不填会报错。占位非空即可（`local` 都行）。

3. **⚠️ settings.yaml 别用 YAML 锚点（`&x` / `*x`）**。settings 服务保存时做节点保留式合并，一旦保存替换了锚点定义者，其余别名就悬空了，整个文档序列化直接炸 `Unresolved alias`——插件和官方"设置→模型"页都会挂。多账号共用模型请写成显式列表。

4. **环境变量是启动时的快照**。进程起来后再 `export` 不生效，得重启。想热改就用 `.credentials.yaml`（被监听，改了立刻生效）。

5. **`apiKeyEnv` 配了但解析不到 → 直接 `MISSING_CREDENTIAL`**，不会退回去用环境里碰巧存在的别的 key。

## 一条捷径：发送键旁的 + 号插件

手写 YAML 虽然零代码，但每次加模型都要编辑文件、记字段、怕写错。我们顺手做了一个**动态插件**（源码开源）：

- 发送键旁边多一个 **+**，点开就是 Provider 面板；
- **预设厂商**：智谱 GLM / MiniMax / OpenAI GPT / Anthropic Claude / 本地 Ollama，端点、协议、推理方言、模型列表全预填；
- **模型选择器**：每个厂商一排快捷模型 chips，点一下就选中/取消（比如 MiniMax 想切 M3，点 `MiniMax-M3` 即可），也能手动加任意模型 id；
- **保存前自动校验模型名**：先请求端点 `GET /models` 对照，名字打错直接红字拦下（把 `GLM-4.6` 打成 `glm4.6v` 会被当场指出）；
- **本地模型自动同步**：Ollama 路由打上"自动同步"标记后，后台每 60 秒对比端点模型列表，`ollama pull` 新模型最多一分钟自动进下拉框；
- **一厂商多 key**：再点同一个厂商，key 自动排号（glm → glm2 → glm3…）；
- 支持正式安装（npm 包 + `dsh.bundle`），重启不丢，无需每次会话批准。

仓库：**lo2589/deepseek-harness-provider**（含完整源码、中英 README、安装文档、踩坑记录）。

## 结尾

DeepSeek Harness 的插件化设计让"接别的模型"变成纯粹的配置问题：两个文件、三种写法、记住五个坑，就够用了。想要更舒服的体验，用那个 + 号插件把配置、校验、同步全包了。

祝你的 harness 早日四通八达。🚀
