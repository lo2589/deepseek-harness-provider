// Provider Quick Config — Client half（正式安装形态）
// 浏览器端由 dsh-client-modules 加载：/plugins/dsh-provider-quick-config/client.js
// 格式：window.__ModuleLoader__.load({ id, factory(require) })——依赖外部化，运行时提供。
// 数据层不走动态插件的 host.call，而是直接用 connection.api（settings/credentials/llm wire），
// 与官方"设置→模型"页同一套接口。纯 React.createElement，无 JSX。
window.__ModuleLoader__.load({
  id: 'dsh-provider-quick-config',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var NS = 'llm-pi-ai'
    var REF = /^[A-Za-z_][A-Za-z0-9_]*$/

    function jsonArgs(obj) {
      var out = {}
      for (var k of Object.keys(obj)) { var v = obj[k]; if (v !== undefined) out[k] = v }
      return out
    }

    // ---- wire data layer（对应官方 store 的用法：result.ok / result.value）----
    async function loadData(api) {
      var settingsRes = await api.settings.describe({})
      if (!settingsRes.result.ok) throw new Error(settingsRes.result.error.message)
      var value = settingsRes.result.value
      var ns = (value.namespaces || []).find((v) => v.ns === NS)
      var rawProviders = (ns !== undefined && ns.user !== undefined && typeof ns.user === 'object' && ns.user.providers !== undefined && typeof ns.user.providers === 'object')
        ? ns.user.providers : {}
      var dirRes = await api.llm.providers({})
      var dir = dirRes.result.ok ? (dirRes.result.value.providers || []) : []
      var catalogKeys = new Set(dir.filter((d) => d.declared !== true).map((d) => d.provider))
      var refs = []
      var entries = []
      for (var key of Object.keys(rawProviders)) {
        var raw = rawProviders[key]
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
        var ref = typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv ? raw.apiKeyEnv : undefined
        if (ref !== undefined) refs.push(ref)
        entries.push({ key, raw, ref })
      }
      var credMap = {}
      if (refs.length > 0) {
        var credRes = await api.credentials.describe({ refs: [...new Set(refs)] })
        if (credRes.result.ok) credMap = credRes.result.value.credentials || {}
      }
      var providers = []
      for (var e of entries) {
        var raw = e.raw
        var models = Array.isArray(raw.models)
          ? raw.models.map((m) => {
            var mm = { id: m !== null && typeof m === 'object' && typeof m.id === 'string' ? m.id : '' }
            if (m !== null && typeof m === 'object' && typeof m.name === 'string') mm.name = m.name
            if (m !== null && typeof m === 'object' && typeof m.contextWindow === 'number') mm.contextWindow = m.contextWindow
            if (m !== null && typeof m === 'object' && typeof m.maxTokens === 'number') mm.maxTokens = m.maxTokens
            if (m !== null && typeof m === 'object' && (m.image === true || (Array.isArray(m.input) && m.input.indexOf('image') >= 0))) mm.image = true
            return mm
          })
          : undefined
        var hasOwnEndpoint = typeof raw.baseURL === 'string' || typeof raw.api === 'string'
          || (Array.isArray(raw.models) && raw.models.length > 0)
        var cred = credMap[e.ref]
        providers.push({
          key: e.key,
          displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : e.key,
          apiKeyEnv: e.ref,
          api: typeof raw.api === 'string' ? raw.api : undefined,
          baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : undefined,
          compat: raw.compat !== undefined && typeof raw.compat === 'object' && typeof raw.compat.thinkingFormat === 'string'
            ? { thinkingFormat: raw.compat.thinkingFormat } : undefined,
          models,
          imageModels: (Array.isArray(models) ? models : []).filter(function (m) {
            return m.image === true || /(gpt-4o|gpt-4\.1|o3\b|o4\b|claude|minicpm|glm-4\.6v|vision|gemini|llava|qwen2\.5-vl)/i.test(m.id)
          }),
          syncModels: raw.syncModels === true,
          catalog: catalogKeys.has(e.key) && !hasOwnEndpoint,
          credential: cred !== undefined
            ? { configured: !!cred.configured, source: cred.source, writable: !!cred.writable }
            : { configured: false, writable: false },
        })
      }
      return {
        available: ns !== undefined,
        writable: !!value.writable,
        revision: ns !== undefined ? ns.revision : 0,
        protocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
        thinkingFormats: ['openai', 'deepseek', 'openrouter', 'together', 'zai', 'qwen', 'string-thinking', 'ant-ling'],
        providers,
      }
    }

    async function saveProviderWire(api, args) {
      var mutateRes = await api.settings.mutate(jsonArgs({
        ns: NS,
        ops: args.ops,
        expectedRevision: args.revision,
      }))
      if (!mutateRes.result.ok) throw new Error(mutateRes.result.error.message)
      var profile = args.ops[0].value
      if (typeof args.apiKey === 'string' && args.apiKey !== '' && profile !== null && typeof profile === 'object' && typeof profile.apiKeyEnv === 'string') {
        var credRes = await api.credentials.set({ ref: profile.apiKeyEnv, value: args.apiKey })
        if (!credRes.result.ok) throw new Error('路由已保存；密钥写入失败: ' + credRes.result.error.message)
      }
    }

    async function removeProviderWire(api, args) {
      var res = await api.settings.mutate(jsonArgs({ ns: NS, ops: args.ops, expectedRevision: args.revision }))
      if (!res.result.ok) throw new Error(res.result.error.message)
    }

    async function discoverModelsWire(api, args) {
      var res = await api.llm.discoverModels(jsonArgs({
        settingsNs: NS,
        baseURL: args.baseURL,
        api: args.api,
        apiKey: args.apiKey,
      }))
      if (!res.result.ok) throw new Error(res.result.error.message)
      return res.result.value.models
    }

    async function pingModelsWire(api, args) {
      var ids = (args.models || []).filter((m) => typeof m === 'string' && m !== '')
      if (ids.length === 0) return { status: 'ok' }
      var listed
      try {
        listed = await discoverModelsWire(api, args)
      } catch (e) {
        return { status: 'unavailable', message: String((e && e.message) || e) }
      }
      if (!Array.isArray(listed) || listed.length === 0) return { status: 'unavailable', message: '端点没有返回模型列表' }
      var norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      var valid = new Set(listed.map((m) => norm(m.id)))
      var missing = ids.filter((id) => !valid.has(norm(id)))
      if (missing.length > 0) return { status: 'missing', missing }
      return { status: 'ok' }
    }

    // ---- presets / 快捷模型 / 容量（与动态版一致）----
    var TPL_CUSTOM = { provider: '__custom__', displayName: '自定义 OpenAI 兼容', declared: true }
    var PRESETS = [
      {
        provider: 'glm', displayName: '智谱 GLM', declared: true,
        api: 'openai-completions', baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        thinkingFormat: 'zai',
        models: [
          { id: 'GLM-4.5-Air', contextWindow: 131072, maxTokens: 32768 },
          { id: 'GLM-4.5', contextWindow: 131072, maxTokens: 32768 },
          { id: 'GLM-4.6', contextWindow: 131072, maxTokens: 32768 },
          { id: 'GLM-4.7-Flash', contextWindow: 131072, maxTokens: 32768 },
        ],
      },
      {
        provider: 'minimax', displayName: 'MiniMax', declared: true,
        api: 'openai-completions', baseURL: 'https://api.minimaxi.com/v1',
        thinkingFormat: 'deepseek',
        models: [
          { id: 'MiniMax-M2.5', contextWindow: 245760, maxTokens: 32768 },
          { id: 'MiniMax-M3', contextWindow: 245760, maxTokens: 32768 },
          { id: 'MiniMax-M1', contextWindow: 245760, maxTokens: 32768 },
          { id: 'MiniMax-Text-01', contextWindow: 245760, maxTokens: 32768 },
        ],
      },
      {
        provider: 'openai', displayName: 'OpenAI GPT', declared: true,
        api: 'openai-completions', baseURL: 'https://api.openai.com/v1',
        thinkingFormat: 'openai',
        models: [
          { id: 'gpt-4o', contextWindow: 128000, maxTokens: 16384 },
          { id: 'gpt-4o-mini', contextWindow: 128000, maxTokens: 16384 },
          { id: 'gpt-4.1', contextWindow: 1047576, maxTokens: 32768 },
          { id: 'gpt-4.1-mini', contextWindow: 1047576, maxTokens: 32768 },
        ],
      },
      {
        provider: 'anthropic', displayName: 'Anthropic Claude', declared: true,
        api: 'anthropic-messages', baseURL: 'https://api.anthropic.com/v1',
        thinkingFormat: '',
        models: [
          { id: 'claude-sonnet-4-5', contextWindow: 200000, maxTokens: 64000 },
          { id: 'claude-opus-4-1', contextWindow: 200000, maxTokens: 32000 },
          { id: 'claude-haiku-4-5', contextWindow: 200000, maxTokens: 64000 },
        ],
      },
      {
        provider: 'ollama', displayName: '本地模型 (Ollama)', declared: true, local: true, syncModels: true,
        api: 'openai-completions', baseURL: 'http://localhost:11434/v1',
        thinkingFormat: 'openai',
        models: [],
      },
      {
        provider: 'mlx', displayName: '本地模型 (MLX)', declared: true, local: true, syncModels: true,
        api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1',
        thinkingFormat: 'openai',
        models: [],
      },
    ]
    var KNOWN = {
      glm: ['GLM-4.5-Air', 'GLM-4.5', 'GLM-4.6', 'GLM-4.7', 'GLM-4.7-Flash', 'GLM-4.6V'],
      minimax: ['MiniMax-M2.5', 'MiniMax-M3', 'MiniMax-M1', 'MiniMax-Text-01'],
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
      anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    }
    var CAP = {
      'GLM-4.5-Air': [131072, 32768], 'GLM-4.5': [131072, 32768], 'GLM-4.6': [131072, 32768],
      'GLM-4.7': [131072, 32768], 'GLM-4.7-Flash': [131072, 32768], 'GLM-4.6V': [131072, 32768],
      'MiniMax-M2.5': [245760, 32768], 'MiniMax-M3': [245760, 32768], 'MiniMax-M1': [245760, 32768], 'MiniMax-Text-01': [245760, 32768],
      'gpt-4o': [128000, 16384], 'gpt-4o-mini': [128000, 16384], 'gpt-4.1': [1047576, 32768], 'gpt-4.1-mini': [1047576, 32768],
      'o3': [200000, 100000], 'o4-mini': [200000, 100000],
      'claude-sonnet-4-5': [200000, 64000], 'claude-opus-4-1': [200000, 32000], 'claude-haiku-4-5': [200000, 64000],
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      var connection = ctx.get('connection')
      if (slots === undefined || connection === undefined) return
      var api = connection.api

      // 样式注入（卸载时移除）
      var styleEl = document.createElement('style')
      styleEl.textContent = '.pp-plus{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;}.pp-plus:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.pp-panel{position:absolute;right:0;bottom:calc(100% + 8px);z-index:100;width:min(440px,calc(100vw - 48px));max-height:min(66vh,600px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);padding:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;}.pp-head{display:flex;align-items:center;justify-content:space-between;padding:2px 2px 8px;flex:none;}.pp-title{font-weight:600;font-size:14px;}.pp-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;cursor:pointer;line-height:1;padding:2px 8px;border-radius:6px;}.pp-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.pp-body{overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-height:0;}.pp-form{gap:8px;}.pp-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;flex:none;}.pp-row-main{display:flex;flex-direction:column;gap:2px;min-width:0;}.pp-row-title{display:flex;align-items:center;gap:6px;}.pp-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:none;}.pp-dot-ok{background:var(--dsw-alias-state-success-primary);}.pp-dot-no{background:var(--dsw-alias-state-warn-primary);}.pp-name{font-weight:600;}.pp-key{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}.pp-badge{font-size:11px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}.pp-badge-custom{color:var(--dsw-alias-brand-primary);}.pp-row-sub{display:flex;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;flex-wrap:wrap;}.pp-env{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}.pp-models{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;}.pp-row-actions{display:flex;gap:6px;flex:none;}.pp-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;}.pp-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-btn-danger{color:var(--dsw-alias-state-error-primary);}.pp-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600;}.pp-btn:disabled{opacity:.5;cursor:default;}.pp-add{margin-top:4px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-brand-primary);border-radius:10px;padding:8px;cursor:pointer;font-size:13px;flex:none;}.pp-add:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-hint{color:var(--dsw-alias-label-secondary);font-size:12px;}.pp-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px;white-space:pre-wrap;word-break:break-word;flex:none;}.pp-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin-top:6px;flex:none;}.pp-status{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:6px;flex:none;}.pp-foot{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:4px;flex:none;}.pp-field{display:flex;flex-direction:column;gap:4px;flex:none;}.pp-label{font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-label2{font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-input{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 8px;font-size:13px;outline:none;width:100%;box-sizing:border-box;}.pp-input:focus{border-color:var(--dsw-alias-brand-primary);}.pp-input:disabled{opacity:.6;}.pp-actions{display:flex;gap:8px;margin-top:2px;flex:none;flex-wrap:wrap;}.pp-check{display:flex;gap:6px;align-items:center;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;}.pp-picker-head{display:flex;align-items:center;gap:8px;padding-bottom:6px;flex:none;}.pp-title2{font-weight:600;}.pp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}.pp-tpl{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:10px;padding:8px 10px;cursor:pointer;color:var(--dsw-alias-label-primary);}.pp-tpl:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-tpl-name{font-weight:600;font-size:13px;}.pp-tpl-key{font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.pp-tpl-custom{border-style:dashed;}.pp-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}.pp-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 8px;font-size:11px;cursor:pointer;}.pp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover);}.pp-search{margin-bottom:2px;flex:none;}.pp-shot-busy{opacity:.5;}.pp-defrow{display:flex;align-items:center;gap:6px;flex:none;}.pp-defsel{flex:1 1 auto;width:auto;padding:4px 8px;font-size:12px;}.pp-mlist{display:flex;flex-direction:column;gap:4px;}.hs-wrap{position:relative;flex:none;}.hs-input{width:150px;padding:4px 8px;font-size:12px;}.hs-drop{position:absolute;top:calc(100% + 4px);right:0;z-index:120;min-width:280px;max-width:360px;max-height:320px;overflow-y:auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted);border-radius:10px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);padding:4px;}.hs-item{border:none;background:transparent;text-align:left;border-radius:8px;padding:6px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:normal;}.hs-item:hover{background:var(--dsw-alias-interactive-bg-hover);}.hs-snippet{display:block;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}.hs-empty{padding:6px 8px;font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-mrow{display:flex;gap:4px;align-items:center;}.pp-mimg{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;}.pp-mid{flex:1 1 auto;}.pp-mnum{flex:0 0 74px;}.pp-mdel{flex:none;}.sc-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;}.sc-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.sc-btn-on{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover);}.sc-panel{position:fixed;top:0;right:0;bottom:0;z-index:500;width:min(300px,calc(100vw - 48px));display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-inverted);background:color-mix(in srgb, var(--dsw-specific-menu) 96%, transparent);box-shadow:var(--dsw-shadow-lv3);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);animation:sc-slide .18s ease-out;backdrop-filter:blur(6px);}.@keyframes sc-slide{from{transform:translateX(100%);}to{transform:translateX(0);}}.sc-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}.sc-title{font-weight:600;font-size:14px;}.sc-tools{display:flex;gap:6px;align-items:center;}.sc-icon-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:2px 8px;font-size:12px;cursor:pointer;}.sc-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.sc-body{flex:1 1 auto;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px;min-height:0;}.sc-group{display:flex;flex-direction:column;gap:6px;}.sc-group-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:2px 2px 0;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:4px;}.sc-empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:24px 8px;}.sc-item{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;flex:none;}.sc-item:hover{border-color:var(--dsw-alias-border-l2);}.sc-item-sel{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary);}.sc-media{display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-1);min-height:72px;max-height:200px;overflow:hidden;}.sc-media img{max-width:100%;max-height:200px;display:block;}.sc-media video{max-width:100%;max-height:200px;display:block;}.sc-media audio{width:100%;padding:16px 8px;box-sizing:border-box;}.sc-meta{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);}.sc-mname{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}.sc-mkind{flex:none;font-size:11px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);}.sc-msize{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;}.sc-item-actions{display:flex;gap:6px;padding:0 10px 8px;flex:none;}.sc-insert{border:1px solid var(--dsw-alias-brand-primary);background:transparent;color:var(--dsw-alias-brand-primary);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;font-weight:600;}.sc-insert:hover{background:var(--dsw-alias-interactive-bg-hover);}.sc-insert:disabled{opacity:.5;cursor:default;}.sc-foot{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);}'
      // ctx.effect's argument is the effect BODY, run immediately, and the
      // disposer is what that body RETURNS. Appending outside and handing the
      // removal in as the body made the style element append and then vanish on
      // the very next line, so the panel rendered with none of its own CSS —
      // no background, no border, no positioning — as bare text over the page.
      ctx.effect(() => {
        document.head.appendChild(styleEl)
        return () => {
          if (styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl)
        }
      }, 'provider-quick-config: styles')

      var store = {
        open: false, view: 'list', busy: false, error: null, notice: null,
        data: null, editing: null, draft: null, confirmKey: null, query: '',
        // 媒体展示台：开关状态持久化（localStorage），点开一次常驻右侧
        showcaseOpen: false, showcaseSession: null, showcaseItems: null, showcaseBusy: false, showcaseError: null,
      }
      try {
        store.showcaseOpen = localStorage.getItem('pp.showcaseOpen') === '1'
      } catch (e) { /* storage unavailable */ }
      function setShowcase(open, sid) {
        setState({ showcaseOpen: open, showcaseSession: sid !== undefined ? sid : store.showcaseSession })
        try {
          if (open) localStorage.setItem('pp.showcaseOpen', '1')
          else localStorage.removeItem('pp.showcaseOpen')
        } catch (e) { /* storage unavailable */ }
      }
      var listeners = new Set()
      function setState(patch) { Object.assign(store, patch); listeners.forEach((fn) => fn()) }
      function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
      function messageOf(e) { return String((e && e.message) || e) }
      function derivedKeyRef(key) { return key.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY' }

      function useStore() {
        var setVersion = React.useState(0)[1]
        React.useEffect(function () {
          var listener = function () { setVersion(function (v) { return v + 1 }) }
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        }, [])
        return store
      }

      async function refresh() {
        try {
          var data = await loadData(api)
          setState({ data, error: null })
          return true
        } catch (e) {
          // Whether store.data actually moved is the caller's business: a
          // conflict retry reusing the revision this call failed to refresh
          // just conflicts again and reports the wrong cause.
          setState({ error: messageOf(e) })
          return false
        }
      }

      var LOCAL_PROBES = [
        { key: 'ollama', displayName: '本地模型 (Ollama)', baseURL: 'http://localhost:11434/v1' },
        { key: 'mlx', displayName: '本地模型 (MLX)', baseURL: 'http://127.0.0.1:8080/v1' },
      ]
      async function autoDetectLocal() {
        if (store.data === null) return
        var have = new Set(store.data.providers.map(function (p) { return p.key }))
        var added = []
        for (var probe of LOCAL_PROBES) {
          if (have.has(probe.key)) continue
          var models
          try {
            models = await discoverModelsWire(api, { baseURL: probe.baseURL, api: 'openai-completions' })
          } catch (e) {
            continue
          }
          if (!Array.isArray(models) || models.length === 0) continue
          var profile = {
            displayName: probe.displayName,
            apiKeyEnv: derivedKeyRef(probe.key),
            api: 'openai-completions',
            baseURL: probe.baseURL,
            compat: { thinkingFormat: 'openai' },
            syncModels: true,
            models: models.map(function (m) {
              var e = { id: m.id }
              if (typeof m.name === 'string' && m.name) e.name = m.name
              if (typeof m.contextWindow === 'number') e.contextWindow = m.contextWindow
              if (typeof m.maxTokens === 'number') e.maxTokens = m.maxTokens
              return e
            }),
          }
          try {
            await saveProviderWire(api, { ops: [{ op: 'set', path: ['providers', probe.key], value: profile }] })
            added.push(probe.displayName)
          } catch (e) {
            // ignore per-probe failure
          }
        }
        if (added.length > 0) {
          await refresh()
          setState({ notice: '自动检测到本地服务并添加: ' + added.join('、') + '（自动同步已开启）' })
        }
      }

      function openPanel() { setState({ open: true, view: 'list', error: null, notice: null, confirmKey: null }); refresh(); autoDetectLocal() }
      function closePanel() { setState({ open: false, view: 'list', editing: null, draft: null, error: null, notice: null, confirmKey: null }) }
      function togglePanel() { if (store.open) closePanel(); else openPanel() }

      async function discover() {
        var d = store.draft
        if (d === null || typeof d.baseURL !== 'string' || !d.baseURL.trim()) { setState({ error: '请先填写 BaseURL 再获取模型' }); return }
        setState({ busy: true, error: null, notice: null })
        try {
          var models = await discoverModelsWire(api, {
            baseURL: d.baseURL.trim(),
            api: typeof d.api === 'string' && d.api ? d.api : undefined,
            apiKey: typeof d.apiKey === 'string' && d.apiKey !== '' ? d.apiKey : undefined,
          })
          if (!Array.isArray(models) || models.length === 0) { setState({ busy: false, error: '端点没有返回可用模型（本地服务没开？或需要密钥？）' }); return }
          var list = models.map((m) => {
            var e = { id: typeof m.id === 'string' ? m.id : '' }
            if (typeof m.name === 'string' && m.name) e.name = m.name
            if (typeof m.contextWindow === 'number') e.contextWindow = String(m.contextWindow)
            if (typeof m.maxTokens === 'number') e.maxTokens = String(m.maxTokens)
            return e
          })
          setState({ draft: Object.assign({}, store.draft, { models: list }), busy: false, notice: '已获取 ' + list.length + ' 个模型' })
        } catch (e) {
          setState({ busy: false, error: '获取模型失败: ' + messageOf(e) })
        }
      }

      function toEditable(list) {
        return (list || []).map((m) => ({
          id: m && typeof m.id === 'string' ? m.id : '',
          name: m && typeof m.name === 'string' ? m.name : '',
          contextWindow: m && typeof m.contextWindow === 'number' ? String(m.contextWindow) : '',
          maxTokens: m && typeof m.maxTokens === 'number' ? String(m.maxTokens) : '',
          image: !!(m && typeof m === 'object' && (m.image === true || (Array.isArray(m.input) && m.input.indexOf('image') >= 0))),
        }))
      }

      function startAdd(template) {
        var custom = template === undefined || template.provider === '__custom__' || template.declared
        var baseKey = template !== undefined && template.provider !== '__custom__' ? template.provider : ''
        var existing = new Set((store.data !== null && Array.isArray(store.data.providers) ? store.data.providers : []).map((p) => p.key))
        var key = baseKey
        if (baseKey !== '' && existing.has(key)) {
          var n = 2
          while (existing.has(baseKey + String(n))) n += 1
          key = baseKey + String(n)
        }
        var displayName = baseKey === ''
          ? ''
          : (template.displayName || baseKey) + (key === baseKey ? '' : ' · 号' + key.slice(baseKey.length))
        var hasModels = template !== undefined && Array.isArray(template.models) && template.models.length > 0
        setState({
          view: 'edit',
          editing: { key, isNew: true, template: custom ? TPL_CUSTOM : template },
          draft: {
            displayName: displayName,
            apiKeyEnv: key ? derivedKeyRef(key) : '',
            apiKey: '',
            api: custom ? (template !== undefined && template.api ? template.api : 'openai-completions') : '',
            baseURL: custom ? (template !== undefined && template.baseURL ? template.baseURL : '') : '',
            thinkingFormat: custom ? (template !== undefined && template.thinkingFormat ? template.thinkingFormat : '') : '',
            syncModels: !!(template !== undefined && template.syncModels),
            models: hasModels
              ? toEditable(template.models)
              : (template !== undefined && template.local ? [] : [{ id: '', name: '', contextWindow: '', maxTokens: '' }]),
          },
          error: null,
          notice: null,
        })
        if (template !== undefined && template.local) discover()
      }

      function startEdit(provider) {
        var hasCustom = !!(provider.baseURL || provider.api || (Array.isArray(provider.models) && provider.models.length > 0))
        var custom = !provider.catalog || hasCustom
        setState({
          view: 'edit',
          editing: { key: provider.key, isNew: false, template: custom
            ? TPL_CUSTOM
            : { provider: provider.key, displayName: provider.displayName, declared: false } },
          draft: {
            displayName: provider.displayName === provider.key ? '' : (provider.displayName || ''),
            apiKeyEnv: provider.apiKeyEnv || '',
            apiKey: '',
            api: provider.api || (custom ? 'openai-completions' : ''),
            baseURL: provider.baseURL || '',
            thinkingFormat: (provider.compat && provider.compat.thinkingFormat) || '',
            syncModels: provider.syncModels === true,
            models: toEditable(provider.models),
          },
          error: null,
          notice: null,
        })
      }

      function setDraft(patch) { setState({ draft: Object.assign({}, store.draft, patch) }) }
      function updateModel(i, patch) {
        var models = (store.draft ? store.draft.models : []) || []
        setDraft({ models: models.map((m, j) => (j === i ? Object.assign({}, m, patch) : m)) })
      }
      function removeModel(i) {
        var models = (store.draft ? store.draft.models : []) || []
        setDraft({ models: models.filter((_, j) => j !== i) })
      }
      function addModel() {
        var models = (store.draft ? store.draft.models : []) || []
        setDraft({ models: models.concat([{ id: '', name: '', contextWindow: '', maxTokens: '' }]) })
      }
      function toggleModel(id) {
        var models = (store.draft ? store.draft.models : []) || []
        var idx = models.findIndex((m) => m.id === id)
        var next
        if (idx >= 0) {
          next = models.filter((_, i) => i !== idx)
        } else {
          var cap = CAP[id] || []
          next = models.concat([{ id: id, name: '', contextWindow: cap[0] !== undefined ? String(cap[0]) : '', maxTokens: cap[1] !== undefined ? String(cap[1]) : '' }])
        }
        setDraft({ models: next })
      }

      // The background model sync writes to the same namespace, so a conflict
      // here is ordinary rather than exceptional: re-read and send again once.
      async function callWithRetry(wire, args) {
        function withRevision() {
          return Object.assign({}, args, { revision: store.data ? store.data.revision : undefined })
        }
        try {
          await wire(api, withRevision())
        } catch (e) {
          if (String((e && e.message) || e).indexOf('SETTINGS_CONFLICT') < 0) throw e
          if (!(await refresh())) throw e
          await wire(api, withRevision())
        }
      }
      async function saveWithRetry(args) {
        await callWithRetry(saveProviderWire, args)
      }

      function setImageDefault(key) {
        if (store.data === null) return
        var ops = store.data.providers.filter(function (p) { return p.image === true }).map(function (p) {
          return { op: 'set', path: ['providers', p.key, 'imageDefault'], value: p.key === key }
        })
        setState({ busy: true, error: null })
        saveProviderWire(api, { ops: ops }).then(function () {
          return refresh()
        }).then(function () {
          setState({ busy: false, notice: '图片默认路由已设为 ' + key + '（带图发送时自动切换）' })
        }).catch(function (e) {
          setState({ busy: false, error: messageOf(e) })
        })
      }

      async function save() {
        var s = store
        var d = s.draft
        if (d === null) return
        var custom = s.editing === null || s.editing.template === null || s.editing.template.declared
        var profile = {}
        if (typeof d.displayName === 'string' && d.displayName.trim()) profile.displayName = d.displayName.trim()
        if (typeof d.apiKeyEnv === 'string' && d.apiKeyEnv.trim()) {
          var ref = d.apiKeyEnv.trim()
          if (!REF.test(ref)) { setState({ error: '环境变量名不合法（须为字母/数字/下划线，且不能以数字开头）' }); return }
          profile.apiKeyEnv = ref
        }
        var key = (s.editing !== null && typeof s.editing.key === 'string' ? s.editing.key : '').trim()
        if (!key) { setState({ error: '路由 key 不能为空' }); return }
        var modelIds = []
        if (custom) {
          if (!d.api) { setState({ error: '请选择 API 协议' }); return }
          if (!d.baseURL || !d.baseURL.trim()) { setState({ error: '请填写 BaseURL' }); return }
          profile.api = d.api
          profile.baseURL = d.baseURL.trim()
          if (d.thinkingFormat) profile.compat = { thinkingFormat: d.thinkingFormat }
          if (d.syncModels) profile.syncModels = true
          var cleaned = []
          for (var m of (d.models || [])) {
            var mid = typeof m.id === 'string' ? m.id.trim() : ''
            if (!mid) continue
            var me = { id: mid }
            if (typeof m.name === 'string' && m.name.trim()) me.name = m.name.trim()
            if (m.image === true) me.input = ['text', 'image']
            var cw = Number(m.contextWindow)
            var mt = Number(m.maxTokens)
            if (Number.isFinite(cw) && cw > 0) me.contextWindow = cw
            if (Number.isFinite(mt) && mt > 0) me.maxTokens = mt
            cleaned.push(me)
          }
          if (cleaned.length === 0) { setState({ error: '至少需要一个模型（点快捷模型、手动填 id，或“自动获取模型”）' }); return }
          profile.models = cleaned
          modelIds = cleaned.map((mm) => mm.id)
        }
        var apiKey = typeof d.apiKey === 'string' ? d.apiKey : ''
        if (apiKey !== '' && !profile.apiKeyEnv) { setState({ error: '填写密钥时必须同时填写环境变量名' }); return }
        setState({ busy: true, error: null, notice: null })
        if (custom && modelIds.length > 0) {
          try {
            var ping = await pingModelsWire(api, {
              baseURL: profile.baseURL,
              api: profile.api,
              apiKey: apiKey !== '' ? apiKey : undefined,
              models: modelIds,
            })
            if (ping !== null && typeof ping === 'object' && ping.status === 'missing'
              && Array.isArray(ping.missing) && ping.missing.length > 0) {
              setState({ busy: false, error: '以下模型在端点模型列表里不存在（名字可能打错了）: ' + ping.missing.join('、') })
              return
            }
          } catch (e) {
            setState({ busy: false, error: '模型校验失败: ' + messageOf(e) })
            return
          }
        }
        var ops = [{ op: 'set', path: ['providers', key], value: profile }]
        try {
          await saveWithRetry({ ops: ops, apiKey: apiKey !== '' ? apiKey : undefined })
          await refresh()
          setState({ busy: false, view: 'list', editing: null, draft: null, notice: '已保存 ' + key + '（热生效）。同一厂商可再点 + 添加第 2 个 key。' })
        } catch (e) {
          setState({ busy: false, error: messageOf(e) })
        }
      }

      async function removeProvider(key) {
        if (store.confirmKey !== key) { setState({ confirmKey: key }); return }
        setState({ busy: true, error: null, confirmKey: null })
        try {
          await callWithRetry(removeProviderWire, { ops: [{ op: 'unset', path: ['providers', key] }] })
          await refresh()
          setState({ busy: false, notice: '已删除 ' + key })
        } catch (e) {
          setState({ busy: false, error: messageOf(e) })
        }
      }

      function HistorySearch() {
        var sessions = ctx.get('sessions')
        var state = React.useState('')
        var query = state[0]
        var setQuery = state[1]
        var resState = React.useState(null)
        var results = resState[0]
        var setResults = resState[1]
        var openState = React.useState(false)
        var open = openState[0]
        var setOpen = openState[1]
        var abortRef = React.useRef(null)
        function doSearch(q) {
          if (abortRef.current !== null) abortRef.current.abort()
          if (sessions === undefined || q.trim() === '') { setResults(null); setOpen(false); return }
          var ctrl = new AbortController()
          abortRef.current = ctrl
          sessions.search(q.trim(), ctrl.signal).then(function (res) {
            if (ctrl.signal.aborted) return
            if (res.ok) { setResults({ items: res.value.items, hasMore: !!res.value.hasMore }); setOpen(true) }
            else { setResults({ items: [], hasMore: false }); setOpen(true) }
          }).catch(function () {
            if (!ctrl.signal.aborted) { setResults([]); setOpen(true) }
          })
        }
        React.useEffect(function () {
          return function () { if (abortRef.current !== null) abortRef.current.abort() }
        }, [])
        return h('div', { className: 'hs-wrap' },
          h('input', { className: 'pp-input hs-input', placeholder: '搜索历史…', value: query,
            onChange: function (e) { var v = e.target.value; setQuery(v); doSearch(v) } }),
          open && results !== null ? h('div', { className: 'hs-drop' },
            results.items.length === 0
              ? h('div', { className: 'hs-empty' }, '无结果')
              : results.hasMore ? h('div', { className: 'hs-empty' }, '结果较多，仅显示前 20 条，用更精确的关键词') : null,
            results.items.length === 0
              ? null
              : results.items.map(function (r) {
                return h('button', { type: 'button', key: r.sessionId, className: 'hs-item',
                  onClick: function () { if (sessions !== undefined) sessions.open(r.sessionId); setOpen(false) } },
                  h('span', { className: 'hs-snippet' }, r.snippet))
              }))
            : null)
      }

      function UploadButton(props) {
        var inputRef = React.useRef(null)
        function onChange(e) {
          var files = Array.from(e.target.files || [])
          e.target.value = ''
          if (files.length === 0) return
          var conversation = ctx.get('conversation')
          if (conversation === undefined || props.inputActions === undefined) return
          var images = conversation.createDraftImages(files)
          if (images.length > 0 && !props.inputActions.addImages(images.map(function (i) { return i.id }))) {
            conversation.releaseDraftImages(images)
          }
        }
        return h('div', { className: 'pp-uploadwrap' },
          h('input', { ref: inputRef, type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onChange: onChange }),
          h('button', { type: 'button', className: 'pp-plus pp-upload', title: '从本地选择图片', 'aria-label': '上传图片',
            onClick: function () { if (inputRef.current !== null) inputRef.current.click() } },
            h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true },
              h('path', { d: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z', fill: 'currentColor' }))))
      }

      function fileToBase64(file) {
        return new Promise(function (res, rej) {
          var reader = new FileReader()
          reader.onload = function () { res(String(reader.result).split(',')[1]) }
          reader.onerror = rej
          reader.readAsDataURL(file)
        })
      }

      async function readAgent(sessionId, imageIds, draftText, inputActions) {
        var conv = ctx.get('conversation')
        if (conv === undefined || store.data === null) return
        var routes = store.data.providers.filter(function (p) { return Array.isArray(p.imageModels) && p.imageModels.length > 0 })
        if (routes.length === 0) { setState({ notice: '还没有可读图的模型（读图能力测试完成后自动出现，稍后再试）' }); return }
        var route = routes.find(function (p) { return p.imageDefault === true }) || routes[0]
        var model = route.imageModels[0].id
        var atts = conv.draftImages(imageIds) || []
        var parts = []
        if (typeof draftText === 'string' && draftText.trim() !== '') parts.push({ type: 'text', text: draftText })
        for (var i = 0; i < atts.length; i++) {
          var a = atts[i]
          if (a === undefined || a.file === undefined) continue
          try {
            var b64 = await fileToBase64(a.file)
            parts.push({ type: 'image', mediaType: a.file.type || 'image/png', data: b64, name: a.file.name })
          } catch (e) { /* skip unreadable */ }
        }
        if (parts.length === 0) return
        var clearDraft = function () {
          if (inputActions !== undefined) {
            for (var j = 0; j < imageIds.length; j++) inputActions.removeImage(imageIds[j])
          }
        }
        setState({ busy: true, error: null, notice: null })
        try {
          var createRes = await api.sessions.create({})
          if (!createRes.result.ok) throw new Error(createRes.result.error.message)
          var sid = createRes.result.value.sessionId
          var sm = await api.sessions.selectModel({ sessionId: sid, provider: route.key, model: model })
          if (!sm.result.ok) throw new Error(sm.result.error.message)
          var pr = await api.sessions.prompt({ sessionId: sid, mode: 'queue', content: parts })
          if (!pr.result.ok) throw new Error(pr.result.error.message)
          clearDraft()
          if (ctx.get('sessions') !== undefined) ctx.get('sessions').open(sid)
          setState({ busy: false, notice: '已发送到读图 Agent（' + (route.displayName || route.key) + ' / ' + model + '），结果在打开的会话里' })
        } catch (e) {
          clearDraft()
          setState({ busy: false, error: '读图失败: ' + messageOf(e) + '（已清空图片，输入框可继续使用）' })
        }
      }

      function ReadAgentButton(props) {
        var loaded = React.useRef(false)
        React.useEffect(function () { if (!loaded.current) { loaded.current = true; refresh() } }, [])
        var imageIds = props.useInput !== undefined ? props.useInput(function (st) { return st ? st.imageIds : [] }) : []
        var draftText = props.useInput !== undefined ? props.useInput(function (st) { return st ? st.draft : '' }) : ''
        if (imageIds.length === 0) return null
        return h('button', { type: 'button', className: 'pp-plus pp-read', title: '用读图 Agent 处理图片',
          'aria-label': '读图', onClick: function () { void readAgent(props.sessionId, imageIds, draftText, props.inputActions) } },
          h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true },
            h('path', { d: 'M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z', fill: 'currentColor' })))
      }

      function ScreenshotButton(props) {
        var busyState = React.useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        async function shoot() {
          if (busy || typeof navigator === 'undefined' || navigator.mediaDevices === undefined
            || navigator.mediaDevices.getDisplayMedia === undefined) {
            setState({ notice: '此浏览器不支持屏幕捕获' })
            return
          }
          setBusy(true)
          var stream
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
          } catch (e) {
            setBusy(false)
            return
          }
          try {
            var video = document.createElement('video')
            video.srcObject = stream
            video.muted = true
            await new Promise(function (res) { video.onloadedmetadata = function () { video.play().then(res, res) } })
            var canvas = document.createElement('canvas')
            canvas.width = video.videoWidth || 1280
            canvas.height = video.videoHeight || 720
            canvas.getContext('2d').drawImage(video, 0, 0)
            var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/png') })
            if (blob === null) return
            var file = new File([blob], 'screenshot.png', { type: 'image/png' })
            var conversation = ctx.get('conversation')
            if (conversation !== undefined && props.inputActions !== undefined) {
              var images = conversation.createDraftImages([file])
              if (images.length > 0 && !props.inputActions.addImages(images.map(function (i) { return i.id }))) {
                conversation.releaseDraftImages(images)
              }
            }
          } finally {
            stream.getTracks().forEach(function (t) { t.stop() })
            setBusy(false)
          }
        }
        return h('button', { type: 'button', className: 'pp-plus pp-shot' + (busy ? ' pp-shot-busy' : ''), title: '截图并插入输入框',
          'aria-label': '截图', onClick: shoot },
          h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
            h('path', { d: 'M3 4.5h2l1-1.5h4l1 1.5h2a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V6A1.5 1.5 0 0 1 3 4.5Zm5 6.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', fill: 'currentColor' })))
      }

      function PlusButton(props) {
        var sessions = ctx.get('sessions')
        var readRef = React.useRef(null)
        var loaded = React.useRef(false)
        React.useEffect(function () { if (!loaded.current) { loaded.current = true; refresh() } }, [])
        var imageIds = props.useInput !== undefined ? props.useInput(function (st) { return st ? st.imageIds : [] }) : []
        var draftText = props.useInput !== undefined ? props.useInput(function (st) { return st ? st.draft : '' }) : ''
        React.useEffect(function () {
          if (imageIds.length === 0 || sessions === undefined || store.data === null) return
          sessions.models({ sessionId: props.sessionId }).then(function (res) {
            if (!res.result.ok) return
            var cur = res.result.value.current
            if (cur === null || cur === undefined) return
            var capable = store.data.providers.some(function (p) { return p.key === cur.provider
              && (p.image === true || (Array.isArray(p.imageModels) && p.imageModels.some(function (m) { return m.id === cur.model }))) })
            if (capable || readRef.current === props.sessionId) return
            readRef.current = props.sessionId
            void readAgent(props.sessionId, imageIds, draftText, props.inputActions)
          })
        }, [imageIds.length, props.sessionId, store.data])
        useStore()
        return h('button', {
          type: 'button', className: 'pp-plus', 'aria-label': '配置 Provider',
          title: '配置模型 Provider（添加/编辑路由、模型与密钥）', 'data-pp-plus': true,
          onMouseDown: (e) => e.preventDefault(),
          onClick: () => togglePanel(),
        }, h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
          h('path', { d: 'M8 3.2v9.6M3.2 8h9.6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' })))
      }

      function renderList(s) {
        var data = s.data
        var rows = []
        if (data !== null) {
          rows.push(h('input', { className: 'pp-input pp-search', key: 'search', placeholder: '搜索厂商 / 模型…', value: s.query || '', onChange: (e) => setState({ query: e.target.value }) }))
        }
        var q = (s.query || '').trim().toLowerCase()
        var all = data !== null && Array.isArray(data.providers) ? data.providers : []
        var visible = q === '' ? all : all.filter(function (pp) {
          var hay = (pp.displayName || pp.key) + ' ' + pp.key + ' ' + (Array.isArray(pp.models) ? pp.models.map(function (m) { return m.id }).join(' ') : '')
          return hay.toLowerCase().indexOf(q) >= 0
        })
        var shown = 0
        if (data === null) {
          rows.push(h('div', { className: 'pp-hint', key: 'loading' }, s.error ? '加载失败（见下方错误）。' : '加载中…'))
          rows.push(h('button', { type: 'button', className: 'pp-btn', key: 'retry', onClick: () => refresh() }, '重试'))
        } else if (!data.available) {
          rows.push(h('div', { className: 'pp-hint', key: 'na' }, 'llm-pi-ai 适配器未挂载，无法在此配置 Provider。'))
        } else if (data.providers.length === 0) {
          rows.push(h('div', { className: 'pp-hint', key: 'empty' }, '还没有配置 Provider，点下方按钮添加。'))
        }
        for (var p of visible) {
          shown += 1
          var cred = p.credential || {}
          var sub = []
          sub.push(h('span', { key: 'url' }, p.baseURL || '（继承目录端点）'))
          if (p.apiKeyEnv) sub.push(h('span', { className: 'pp-env', key: 'env' }, p.apiKeyEnv + (cred.configured ? ' ✓' : ' ✗')))
          if (Array.isArray(p.models) && p.models.length > 0) {
            var ids = p.models.map((m) => m.id).join('、')
            sub.push(h('span', { className: 'pp-models', key: 'models', title: ids }, ids.length > 40 ? ids.slice(0, 40) + '…' : ids))
          }
          var badges = [
            h('span', { className: 'pp-badge' + (p.catalog ? '' : ' pp-badge-custom'), key: 'badge' }, p.catalog ? '目录' : '自定义'),
            p.syncModels ? h('span', { className: 'pp-badge', key: 'sync' }, '自动同步') : null,
          ]
          rows.push(h('div', { className: 'pp-row', key: p.key },
            h('div', { className: 'pp-row-main' },
              h('div', { className: 'pp-row-title' },
                h('span', { className: 'pp-dot ' + (cred.configured ? 'pp-dot-ok' : 'pp-dot-no'), key: 'dot' }),
                h('span', { className: 'pp-name', key: 'name' }, p.displayName || p.key),
                h('span', { className: 'pp-key', key: 'key' }, p.key),
                ...badges),
              h('div', { className: 'pp-row-sub' }, sub)),
            h('div', { className: 'pp-row-actions' },
              h('button', { type: 'button', className: 'pp-btn', onClick: () => startEdit(p), key: 'edit' }, '编辑'),
              h('button', { type: 'button', className: 'pp-btn pp-btn-danger', onClick: () => removeProvider(p.key), key: 'del' }, s.confirmKey === p.key ? '确认删除' : '删除'))))
        }
        if (q !== '' && shown === 0) {
          if (data !== null) {
            var imgRoutes = data.providers.filter(function (p) { return p.image === true })
            if (imgRoutes.length > 0) {
              var cur = imgRoutes.find(function (p) { return p.imageDefault === true })
              rows.push(h('div', { className: 'pp-defrow', key: 'imgdef' },
                h('span', { className: 'pp-label2' }, '图片默认路由:'),
                h('select', { className: 'pp-input pp-defsel', value: cur ? cur.key : '', onChange: function (e) { setImageDefault(e.target.value) } },
                  imgRoutes.map(function (p) { return h('option', { value: p.key, key: p.key }, p.displayName || p.key) }))))
            }
          }
          rows.push(h('div', { className: 'pp-hint', key: 'no-match' }, '没有匹配的厂商或模型'))
        }
                rows.push(h('button', { type: 'button', className: 'pp-add', key: 'add', onClick: () => setState({ view: 'picker' }) }, '+ 添加 Provider'))
        rows.push(h('div', { className: 'pp-foot', key: 'foot' }, '保存前自动校验模型名 · 打“自动同步”的路由后台每 60s 与端点对齐'))
        return h('div', { className: 'pp-body' }, rows)
      }

      function renderPicker(s) {
        var items = PRESETS.map((p) => h('button', { type: 'button', className: 'pp-tpl', key: p.provider, onClick: () => startAdd(p) },
          h('span', { className: 'pp-tpl-name' }, p.displayName),
          h('span', { className: 'pp-tpl-key' }, p.local ? (p.baseURL + ' · 自动同步模型') : (p.baseURL || p.provider))))
        items.push(h('button', { type: 'button', className: 'pp-tpl pp-tpl-custom', key: '__custom__', onClick: () => startAdd(TPL_CUSTOM) },
          h('span', { className: 'pp-tpl-name' }, '自定义 OpenAI 兼容'),
          h('span', { className: 'pp-tpl-key' }, '任意网关 / 自建端点 / 本地服务')))
        return h('div', { className: 'pp-body' },
          h('div', { className: 'pp-picker-head' },
            h('button', { type: 'button', className: 'pp-btn', onClick: () => setState({ view: 'list' }) }, '← 返回'),
            h('span', { className: 'pp-title2' }, '选择厂商（同一个厂商可加多个 key）')),
          h('div', { className: 'pp-grid' }, items))
      }

      function renderEdit(s) {
        var d = s.draft
        if (d === null) return null
        var custom = s.editing === null || s.editing.template === null || s.editing.template.declared
        var protocols = s.data !== null && Array.isArray(s.data.protocols) ? s.data.protocols : ['openai-completions', 'openai-responses', 'anthropic-messages']
        var formats = s.data !== null && Array.isArray(s.data.thinkingFormats) ? s.data.thinkingFormats : []
        var base = s.editing !== null && s.editing.template !== null && typeof s.editing.template.provider === 'string'
          ? s.editing.template.provider : (s.editing !== null ? s.editing.key : '')
        var known = KNOWN[base] || []
        function field(label, node, hint) {
          return h('label', { className: 'pp-field' },
            h('span', { className: 'pp-label' }, label), node,
            hint ? h('span', { className: 'pp-hint' }, hint) : null)
        }
        function section(label, node, hint) {
          return h('div', { className: 'pp-field' },
            h('span', { className: 'pp-label' }, label), node,
            hint ? h('span', { className: 'pp-hint' }, hint) : null)
        }
        var inputs = []
        inputs.push(field('路由 key（唯一标识，保存后不可改）',
          h('input', { className: 'pp-input', value: s.editing !== null ? s.editing.key : '', disabled: !(s.editing !== null && s.editing.isNew), onChange: (e) => setState({ editing: Object.assign({}, s.editing, { key: e.target.value }) }) })))
        inputs.push(field('显示名',
          h('input', { className: 'pp-input', value: d.displayName || '', placeholder: '选填，默认用 key', onChange: (e) => setDraft({ displayName: e.target.value }) })))
        inputs.push(field('凭据引用（环境变量名）',
          h('input', { className: 'pp-input', value: d.apiKeyEnv || '', placeholder: '如 GLM_API_KEY', onChange: (e) => setDraft({ apiKeyEnv: e.target.value }) })))
        inputs.push(field('API 密钥',
          h('input', { className: 'pp-input', type: 'password', value: d.apiKey || '', placeholder: '留空 = 不改动 / 用环境变量', autoComplete: 'off', onChange: (e) => setDraft({ apiKey: e.target.value }) }),
          '写入 ~/.dsh/.credentials.yaml（0600），热生效'))
        if (custom) {
          inputs.push(field('API 协议',
            h('select', { className: 'pp-input', value: d.api || '', onChange: (e) => setDraft({ api: e.target.value }) },
              protocols.map((p) => h('option', { value: p, key: p }, p)))))
          inputs.push(field('BaseURL',
            h('input', { className: 'pp-input', value: d.baseURL || '', placeholder: 'https://…/v1 或 http://localhost:11434/v1', onChange: (e) => setDraft({ baseURL: e.target.value }) })))
          inputs.push(field('推理格式 thinkingFormat',
            h('select', { className: 'pp-input', value: d.thinkingFormat || '', onChange: (e) => setDraft({ thinkingFormat: e.target.value }) },
              [h('option', { value: '', key: '' }, '自动')].concat(formats.map((f) => h('option', { value: f, key: f }, f)))),
            'openai-completions 方言：GLM=zai，MiniMax=deepseek'))
          inputs.push(section('自动同步模型',
            h('label', { className: 'pp-check' },
              h('input', { type: 'checkbox', checked: d.syncModels === true, onChange: (e) => setDraft({ syncModels: e.target.checked }) }),
              h('span', null, '端点模型列表变化时自动更新本路由的模型（后台每 60s 检查，端点为准）'))))
          var chipRow = known.length > 0
            ? h('div', { className: 'pp-chips', key: 'chips' },
              h('span', { className: 'pp-label2' }, '快捷模型：'),
              known.map((id) => h('button', { type: 'button', className: 'pp-chip' + ((d.models || []).some((m) => m.id === id) ? ' pp-chip-on' : ''), key: id, onClick: () => toggleModel(id) }, id)))
            : null
          var modelRows = (d.models || []).map((m, i) => h('div', { className: 'pp-mrow', key: i },
            h('input', { className: 'pp-input pp-mid', value: m.id || '', placeholder: '模型 id', onChange: (e) => updateModel(i, { id: e.target.value }) }),
            h('input', { className: 'pp-input pp-mnum', type: 'number', value: m.contextWindow || '', placeholder: 'ctx', title: 'contextWindow', onChange: (e) => updateModel(i, { contextWindow: e.target.value }) }),
            h('input', { className: 'pp-input pp-mnum', type: 'number', value: m.maxTokens || '', placeholder: 'max', title: 'maxTokens', onChange: (e) => updateModel(i, { maxTokens: e.target.value }) }),
            h('label', { className: 'pp-mimg', title: '可读图（input: text+image）' },
              h('input', { type: 'checkbox', checked: m.image === true, onChange: (e) => updateModel(i, { image: e.target.checked }) }), '图'),
            h('button', { type: 'button', className: 'pp-btn pp-btn-danger pp-mdel', onClick: () => removeModel(i) }, '×')))
          inputs.push(section('模型列表（保存前自动校验模型名；点快捷模型选中/取消）',
            h('div', { className: 'pp-mlist' },
              chipRow, modelRows,
              h('div', { className: 'pp-actions' },
                h('button', { type: 'button', className: 'pp-btn', disabled: s.busy, onClick: () => discover() }, s.busy ? '获取中…' : '自动获取模型'),
                h('button', { type: 'button', className: 'pp-btn', onClick: () => addModel() }, '+ 添加模型')))))
        } else {
          inputs.push(h('div', { className: 'pp-hint', key: 'catalog-note' }, '目录路线：端点 / 协议 / 模型继承 pi-ai 目录，这里只需 key、显示名与密钥。'))
        }
        inputs.push(h('div', { className: 'pp-actions', key: 'actions' },
          h('button', { type: 'button', className: 'pp-btn pp-btn-primary', disabled: s.busy, onClick: () => save() }, '保存'),
          h('button', { type: 'button', className: 'pp-btn', onClick: () => setState({ view: s.editing !== null && s.editing.isNew ? 'picker' : 'list', editing: null, draft: null, error: null }) }, '取消')))
        return h('div', { className: 'pp-body pp-form' }, inputs)
      }

      function ProviderPanel() {
        var s = useStore()
        if (!s.open) return null
        var content = s.view === 'picker' ? renderPicker(s) : s.view === 'edit' ? renderEdit(s) : renderList(s)
        return h('div', { className: 'pp-panel', 'data-pp-panel': true, 'data-pp-version': 'f1' },
          h('div', { className: 'pp-head' },
            h('span', { className: 'pp-title' }, s.view === 'edit'
              ? (s.editing !== null && s.editing.isNew ? '添加 Provider' : '编辑 Provider')
              : s.view === 'picker' ? '添加 Provider' : 'Provider 配置'),
            h('button', { type: 'button', className: 'pp-close', 'aria-label': '关闭', onClick: () => closePanel() }, '×')),
          content,
          s.busy ? h('div', { className: 'pp-status' }, '处理中…') : null,
          s.error ? h('div', { className: 'pp-err' }, String(s.error)) : null,
          s.notice ? h('div', { className: 'pp-ok' }, String(s.notice)) : null)
      }

      // ---- 媒体展示台 ----
      // 打开时拉取当前会话已收集的媒体（图片/视频/录音）列表，图片/视频/录音可预览，
      // 选中后可"插入"把图片发回当前对话草稿。数据来自 Host 的 webServer 接口（同源 fetch）。
      var MEDIA_ROUTE = '/plugins/provider-quick-config'
      function mediaUrl(sessionId, path) {
        return MEDIA_ROUTE + '/media?session=' + encodeURIComponent(sessionId) + '&p=' + encodeURIComponent(path)
      }
      async function loadShowcase(sessionId) {
        if (sessionId === undefined || sessionId === null) return
        setState({ showcaseBusy: true, showcaseError: null })
        try {
          var res = await fetch(MEDIA_ROUTE + '/media-list?session=' + encodeURIComponent(sessionId))
          if (!res.ok) throw new Error('HTTP ' + res.status)
          var body = await res.json()
          setState({ showcaseItems: Array.isArray(body.items) ? body.items : [], showcaseBusy: false })
        } catch (e) {
          setState({ showcaseBusy: false, showcaseError: messageOf(e) })
        }
      }
      function fmtSize(n) {
        if (typeof n !== 'number' || !isFinite(n)) return ''
        if (n < 1024) return n + ' B'
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
        return (n / 1024 / 1024).toFixed(1) + ' MB'
      }
      function MediaItem(props) {
        var item = props.item
        var url = mediaUrl(props.sessionId, item.path)
        var media
        if (item.kind === 'image') {
          media = h('img', { src: url, alt: item.name, loading: 'lazy' })
        } else if (item.kind === 'video') {
          media = h('video', { src: url, controls: true, preload: 'metadata' })
        } else if (item.kind === 'audio') {
          media = h('audio', { src: url, controls: true, preload: 'metadata' })
        } else {
          media = h('span', { className: 'sc-empty' }, item.name)
        }
        var insertable = item.kind === 'image'
        return h('div', { className: 'sc-item' + (props.selected ? ' sc-item-sel' : ''),
            onClick: () => { if (props.onSelect !== undefined) props.onSelect(item) } },
          h('div', { className: 'sc-media' }, media),
          h('div', { className: 'sc-meta' },
            h('span', { className: 'sc-mkind' }, item.kind),
            h('span', { className: 'sc-mname', title: item.path }, item.name),
            h('span', { className: 'sc-msize' }, fmtSize(item.size))),
          h('div', { className: 'sc-item-actions' },
            h('button', { type: 'button', className: 'sc-insert', disabled: !insertable,
                onClick: (e) => { e.stopPropagation(); if (props.onInsert !== undefined) props.onInsert(item) } },
              insertable ? '插入对话' : '仅预览')))
      }
      function ShowcasePanel() {
        var s = useStore()
        var selState = React.useState(null)
        var selected = selState[0]
        var setSelected = selState[1]
        React.useEffect(function () {
          if (s.showcaseOpen) void loadShowcase(s.showcaseSession)
        }, [s.showcaseOpen, s.showcaseSession])
        if (!s.showcaseOpen) return null
        var items = Array.isArray(s.showcaseItems) ? s.showcaseItems : []
        // 按轮次分组：items 带 turn 字段（Host 扫描时标注），同轮归一组，按轮次升序
        var groups = []
        var groupMap = new Map()
        for (var i = 0; i < items.length; i++) {
          var it = items[i]
          var t = typeof it.turn === 'number' ? it.turn : 0
          var g = groupMap.get(t)
          if (g === undefined) { g = { turn: t, items: [] }; groupMap.set(t, g); groups.push(g) }
          g.items.push(it)
        }
        function renderGroup(g) {
          return h('div', { key: 'g' + g.turn, className: 'sc-group' },
            h('div', { className: 'sc-group-title' }, '第 ' + (g.turn + 1) + ' 轮'),
            g.items.map(function (item) {
              return h(MediaItem, { key: item.path, item: item, sessionId: s.showcaseSession,
                selected: selected !== null && selected.path === item.path,
                onSelect: (it) => setSelected(it), onInsert: (it) => doInsert(it) })
            }))
        }
        function doInsert(item) {
          if (item.kind !== 'image') return
          // 图片通过 fetch 拿 blob → createDraftImages → 加入草稿
          fetch(mediaUrl(s.showcaseSession, item.path)).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.blob()
          }).then(function (blob) {
            var conv = ctx.get('conversation')
            if (conv === undefined || typeof conv.createDraftImages !== 'function') {
              setState({ showcaseError: '当前环境不支持插入图片' })
              return
            }
            var file = new File([blob], item.name, { type: blob.type || 'application/octet-stream' })
            var ids = conv.createDraftImages([file])
            setState({ showcaseError: null })
          }).catch(function (e) {
            setState({ showcaseError: messageOf(e) })
          })
        }
        return h('div', null,
          // 常驻侧栏：不设全屏遮罩（overlay 层本身点击穿透），不挡对话框交互
          h('div', { className: 'sc-panel' },
            h('div', { className: 'sc-head' },
              h('span', { className: 'sc-title' }, '媒体展示台'),
              h('div', { className: 'sc-tools' },
                h('button', { type: 'button', className: 'sc-icon-btn', onClick: () => void loadShowcase(s.showcaseSession) }, '刷新'),
                h('button', { type: 'button', className: 'sc-icon-btn', 'aria-label': '关闭', onClick: () => setShowcase(false) }, '×'))),
            h('div', { className: 'sc-body' },
              s.showcaseBusy && items.length === 0 ? h('div', { className: 'sc-empty' }, '加载中…') : null,
              s.showcaseError !== null ? h('div', { className: 'sc-empty' }, String(s.showcaseError)) : null,
              !s.showcaseBusy && s.showcaseError === null && items.length === 0 ? h('div', { className: 'sc-empty' }, '本会话还没提到媒体文件。对话里提到图片/视频/录音文件名（含路径）后会自动出现在这里。') : null,
              groups.map(renderGroup)),
            h('div', { className: 'sc-foot' }, items.length + ' 项 · 数据不进模型上下文，仅展示')))
      }
      function ShowcaseButton(props) {
        var s = useStore()
        var sid = props.sessionId !== undefined ? props.sessionId : null
        if (sid !== null && s.showcaseSession !== sid) {
          // 会话切换时同步并触发一次加载
          setState({ showcaseSession: sid, showcaseItems: null })
        }
        return h('button', {
          type: 'button',
          className: 'sc-btn' + (s.showcaseOpen ? ' sc-btn-on' : ''),
          'aria-label': '媒体展示台',
          title: '媒体展示台（本会话提到的图片/视频/录音）',
          onClick: () => { setShowcase(!s.showcaseOpen, sid) },
        }, h('span', { role: 'img', 'aria-hidden': true }, '🎞'))
      }

      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'media-showcase', order: 2 },
        (props) => React.createElement(ShowcaseButton, props),
      ))
      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'history-search', order: 1 },
        () => React.createElement(HistorySearch),
      ))
      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'read-agent-btn', order: -3 },
        (props) => React.createElement(ReadAgentButton, props),
      ))
      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'upload-btn', order: -2 },
        (props) => React.createElement(UploadButton, props),
      ))
      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'screenshot-btn', order: -1 },
        (props) => React.createElement(ScreenshotButton, props),
      ))
      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'provider-plus', order: 0 },
        (props) => React.createElement(PlusButton, props),
      ))
      slots.inject('conversation.input.overlay', () => slots.register(
        { name: 'conversation.input.overlay', id: 'provider-panel', order: 2 },
        () => React.createElement(ProviderPanel),
      ))
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'media-showcase-panel', order: 3 },
        () => React.createElement(ShowcasePanel),
      ))
    }

    module.exports = { name: 'provider-quick-config', inject: ['slots', 'connection', 'sessions'], apply }
    return module.exports
  },
})
