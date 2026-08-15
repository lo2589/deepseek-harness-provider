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
      styleEl.textContent = '.pp-plus{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;}.pp-plus:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.pp-panel{position:absolute;right:0;bottom:calc(100% + 8px);z-index:100;width:min(440px,calc(100vw - 48px));max-height:min(66vh,600px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);padding:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;}.pp-head{display:flex;align-items:center;justify-content:space-between;padding:2px 2px 8px;flex:none;}.pp-title{font-weight:600;font-size:14px;}.pp-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;cursor:pointer;line-height:1;padding:2px 8px;border-radius:6px;}.pp-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.pp-body{overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-height:0;}.pp-form{gap:8px;}.pp-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;flex:none;}.pp-row-main{display:flex;flex-direction:column;gap:2px;min-width:0;}.pp-row-title{display:flex;align-items:center;gap:6px;}.pp-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:none;}.pp-dot-ok{background:var(--dsw-alias-state-success-primary);}.pp-dot-no{background:var(--dsw-alias-state-warn-primary);}.pp-name{font-weight:600;}.pp-key{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}.pp-badge{font-size:11px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}.pp-badge-custom{color:var(--dsw-alias-brand-primary);}.pp-row-sub{display:flex;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;flex-wrap:wrap;}.pp-env{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}.pp-models{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;}.pp-row-actions{display:flex;gap:6px;flex:none;}.pp-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;}.pp-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-btn-danger{color:var(--dsw-alias-state-error-primary);}.pp-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600;}.pp-btn:disabled{opacity:.5;cursor:default;}.pp-add{margin-top:4px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-brand-primary);border-radius:10px;padding:8px;cursor:pointer;font-size:13px;flex:none;}.pp-add:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-hint{color:var(--dsw-alias-label-secondary);font-size:12px;}.pp-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px;white-space:pre-wrap;word-break:break-word;flex:none;}.pp-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin-top:6px;flex:none;}.pp-status{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:6px;flex:none;}.pp-foot{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:4px;flex:none;}.pp-field{display:flex;flex-direction:column;gap:4px;flex:none;}.pp-label{font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-label2{font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-input{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 8px;font-size:13px;outline:none;width:100%;box-sizing:border-box;}.pp-input:focus{border-color:var(--dsw-alias-brand-primary);}.pp-input:disabled{opacity:.6;}.pp-actions{display:flex;gap:8px;margin-top:2px;flex:none;flex-wrap:wrap;}.pp-check{display:flex;gap:6px;align-items:center;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;}.pp-picker-head{display:flex;align-items:center;gap:8px;padding-bottom:6px;flex:none;}.pp-title2{font-weight:600;}.pp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}.pp-tpl{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:10px;padding:8px 10px;cursor:pointer;color:var(--dsw-alias-label-primary);}.pp-tpl:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-tpl-name{font-weight:600;font-size:13px;}.pp-tpl-key{font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.pp-tpl-custom{border-style:dashed;}.pp-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}.pp-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 8px;font-size:11px;cursor:pointer;}.pp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover);}.pp-mlist{display:flex;flex-direction:column;gap:4px;}.pp-mrow{display:flex;gap:4px;align-items:center;}.pp-mid{flex:1 1 auto;}.pp-mnum{flex:0 0 74px;}.pp-mdel{flex:none;}'
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
        data: null, editing: null, draft: null, confirmKey: null,
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

      function openPanel() { setState({ open: true, view: 'list', error: null, notice: null, confirmKey: null }); refresh() }
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

      function PlusButton() {
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
        if (data === null) {
          rows.push(h('div', { className: 'pp-hint', key: 'loading' }, s.error ? '加载失败（见下方错误）。' : '加载中…'))
          rows.push(h('button', { type: 'button', className: 'pp-btn', key: 'retry', onClick: () => refresh() }, '重试'))
        } else if (!data.available) {
          rows.push(h('div', { className: 'pp-hint', key: 'na' }, 'llm-pi-ai 适配器未挂载，无法在此配置 Provider。'))
        } else if (data.providers.length === 0) {
          rows.push(h('div', { className: 'pp-hint', key: 'empty' }, '还没有配置 Provider，点下方按钮添加。'))
        }
        for (var p of data !== null && Array.isArray(data.providers) ? data.providers : []) {
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

      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'provider-plus', order: 0 },
        () => React.createElement(PlusButton),
      ))
      slots.inject('conversation.input.overlay', () => slots.register(
        { name: 'conversation.input.overlay', id: 'provider-panel', order: 2 },
        () => React.createElement(ProviderPanel),
      ))
    }

    module.exports = { name: 'provider-quick-config', inject: ['slots', 'connection'], apply }
    return module.exports
  },
})
