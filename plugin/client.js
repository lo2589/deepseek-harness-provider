// Provider Quick Config — Client half (code.client of the dynamic Cordis plugin).
// This file is the exact body passed to cordis_define(code.client). It runs in
// the browser as a closure: plain JavaScript only (no JSX/import), React is a
// closure symbol, UI must be registered in queried Slots via React.createElement.
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const h = React.createElement
    const TPL_CUSTOM = { provider: '__custom__', displayName: '自定义 OpenAI 兼容', declared: true }
    const PRESETS = [
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
    const KNOWN = {
      glm: ['GLM-4.5-Air', 'GLM-4.5', 'GLM-4.6', 'GLM-4.7', 'GLM-4.7-Flash', 'GLM-4.6V'],
      minimax: ['MiniMax-M2.5', 'MiniMax-M3', 'MiniMax-M1', 'MiniMax-Text-01'],
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
      anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    }
    const CAP = {
      'GLM-4.5-Air': [131072, 32768], 'GLM-4.5': [131072, 32768], 'GLM-4.6': [131072, 32768],
      'GLM-4.7': [131072, 32768], 'GLM-4.7-Flash': [131072, 32768], 'GLM-4.6V': [131072, 32768],
      'MiniMax-M2.5': [245760, 32768], 'MiniMax-M3': [245760, 32768], 'MiniMax-M1': [245760, 32768], 'MiniMax-Text-01': [245760, 32768],
      'gpt-4o': [128000, 16384], 'gpt-4o-mini': [128000, 16384], 'gpt-4.1': [1047576, 32768], 'gpt-4.1-mini': [1047576, 32768],
      'o3': [200000, 100000], 'o4-mini': [200000, 100000],
      'claude-sonnet-4-5': [200000, 64000], 'claude-opus-4-1': [200000, 32000], 'claude-haiku-4-5': [200000, 64000],
    }
    const REF = /^[A-Za-z_][A-Za-z0-9_]*$/

    const store = {
      open: false,
      view: 'list',
      busy: false,
      error: null,
      notice: null,
      data: null,
      editing: null,
      draft: null,
      confirmKey: null,
      query: '',
    }
    const listeners = new Set()
    const setState = (patch) => {
      Object.assign(store, patch)
      listeners.forEach((fn) => fn())
    }
    const subscribe = (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
    const messageOf = (e) => String((e && e.message) || e)
    const derivedKeyRef = (key) => key.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY'
    const jsonArgs = (obj) => {
      const out = {}
      for (const k of Object.keys(obj)) {
        const v = obj[k]
        if (v !== undefined) out[k] = v
      }
      return out
    }

    const useStore = () => {
      const [, setVersion] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setVersion((v) => v + 1)
        listeners.add(listener)
        return () => listeners.delete(listener)
      }, [])
      return store
    }

    const refresh = async () => {
      const timer = ctx.get('timer')
      let timedOut = false
      const call = host.call('providers.list')
      call.then(() => {}, () => {})
      const deadline = timer !== undefined
        ? timer.timeout(12000).then(() => { timedOut = true })
        : new Promise(() => {})
      try {
        await Promise.race([call, deadline])
        if (!timedOut) {
          setState({ data: await call, error: null })
          return true
        }
      } catch (e) {
        if (!timedOut) setState({ error: messageOf(e) })
        return false
      }
      // Whether `store.data` actually moved is the caller's business: a
      // conflict retry that reuses the revision this call failed to refresh
      // just conflicts again and reports the wrong cause.
      setState({ error: '加载超时（12 秒）。多半是页面还连着旧插件，请刷新页面（Cmd/Ctrl+Shift+R）后重试。' })
      return false
    }

    const LOCAL_PROBES = [
      { key: 'ollama', displayName: '本地模型 (Ollama)', baseURL: 'http://localhost:11434/v1' },
      { key: 'mlx', displayName: '本地模型 (MLX)', baseURL: 'http://127.0.0.1:8080/v1' },
    ]
    async function autoDetectLocal() {
      if (store.data === null) return
      const have = new Set(store.data.providers.map((p) => p.key))
      const added = []
      for (const probe of LOCAL_PROBES) {
        if (have.has(probe.key)) continue
        let models
        try {
          models = await host.call('providers.discover', jsonArgs({ baseURL: probe.baseURL, api: 'openai-completions' }))
        } catch (e) {
          continue
        }
        if (!Array.isArray(models) || models.length === 0) continue
        const profile = {
          displayName: probe.displayName,
          apiKeyEnv: derivedKeyRef(probe.key),
          api: 'openai-completions',
          baseURL: probe.baseURL,
          compat: { thinkingFormat: 'openai' },
          syncModels: true,
          models: models.map((m) => {
            const e = { id: m.id }
            if (typeof m.name === 'string' && m.name) e.name = m.name
            if (typeof m.contextWindow === 'number') e.contextWindow = m.contextWindow
            if (typeof m.maxTokens === 'number') e.maxTokens = m.maxTokens
            return e
          }),
        }
        try {
          await host.call('providers.save', jsonArgs({ ops: [{ op: 'set', path: ['providers', probe.key], value: profile }] }))
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

    const openPanel = () => {
      setState({ open: true, view: 'list', error: null, notice: null, confirmKey: null })
      refresh()
      autoDetectLocal()
    }
    const closePanel = () => {
      setState({ open: false, view: 'list', editing: null, draft: null, error: null, notice: null, confirmKey: null })
    }
    const togglePanel = () => (store.open ? closePanel() : openPanel())

    async function discover() {
      const d = store.draft
      if (d === null || typeof d.baseURL !== 'string' || !d.baseURL.trim()) {
        setState({ error: '请先填写 BaseURL 再获取模型' })
        return
      }
      setState({ busy: true, error: null, notice: null })
      try {
        const models = await host.call('providers.discover', jsonArgs({
          baseURL: d.baseURL.trim(),
          api: typeof d.api === 'string' && d.api ? d.api : undefined,
          apiKey: typeof d.apiKey === 'string' && d.apiKey !== '' ? d.apiKey : undefined,
          apiKeyEnv: typeof d.apiKeyEnv === 'string' && d.apiKeyEnv !== '' ? d.apiKeyEnv : undefined,
        }))
        if (!Array.isArray(models) || models.length === 0) {
          setState({ busy: false, error: '端点没有返回可用模型（本地服务没开？或需要密钥？）' })
          return
        }
        const list = models.map((m) => {
          const e = { id: typeof m.id === 'string' ? m.id : '' }
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

    const toEditable = (list) => (list || []).map((m) => ({
      id: m && typeof m.id === 'string' ? m.id : '',
      name: m && typeof m.name === 'string' ? m.name : '',
      contextWindow: m && typeof m.contextWindow === 'number' ? String(m.contextWindow) : '',
      maxTokens: m && typeof m.maxTokens === 'number' ? String(m.maxTokens) : '',
    }))

    const startAdd = (template) => {
      const custom = template === undefined || template.provider === '__custom__' || template.declared
      const baseKey = template !== undefined && template.provider !== '__custom__' ? template.provider : ''
      const existing = new Set((store.data !== null && Array.isArray(store.data.providers) ? store.data.providers : []).map((p) => p.key))
      let key = baseKey
      if (baseKey !== '' && existing.has(key)) {
        let n = 2
        while (existing.has(baseKey + String(n))) n += 1
        key = baseKey + String(n)
      }
      const displayName = baseKey === ''
        ? ''
        : (template.displayName || baseKey) + (key === baseKey ? '' : ' · 号' + key.slice(baseKey.length))
      const hasModels = template !== undefined && Array.isArray(template.models) && template.models.length > 0
      setState({
        view: 'edit',
        editing: { key, isNew: true, template: custom ? TPL_CUSTOM : template },
        draft: {
          displayName,
          apiKeyEnv: key ? derivedKeyRef(key) : '',
          apiKey: '',
          api: custom ? (template !== undefined && template.api ? template.api : 'openai-completions') : '',
          baseURL: custom ? (template !== undefined && template.baseURL ? template.baseURL : '') : '',
          thinkingFormat: custom ? (template !== undefined && template.thinkingFormat ? template.thinkingFormat : '') : '',
          syncModels: !!(template !== undefined && template.syncModels),
          image: !!(template !== undefined && template.image),
          models: hasModels
            ? toEditable(template.models)
            : (template !== undefined && template.local ? [] : [{ id: '', name: '', contextWindow: '', maxTokens: '' }]),
        },
        error: null,
        notice: null,
      })
      if (template !== undefined && template.local) discover()
    }

    const startEdit = (provider) => {
      const hasCustom = !!(provider.baseURL || provider.api || (Array.isArray(provider.models) && provider.models.length > 0))
      const custom = !provider.catalog || hasCustom
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
          image: provider.image === true,
          models: toEditable(provider.models),
        },
        error: null,
        notice: null,
      })
    }

    const setDraft = (patch) => setState({ draft: Object.assign({}, store.draft, patch) })
    const updateModel = (i, patch) => {
      const models = (store.draft ? store.draft.models : []) || []
      setDraft({ models: models.map((m, j) => (j === i ? Object.assign({}, m, patch) : m)) })
    }
    const removeModel = (i) => {
      const models = (store.draft ? store.draft.models : []) || []
      setDraft({ models: models.filter((_, j) => j !== i) })
    }
    const addModel = () => {
      const models = (store.draft ? store.draft.models : []) || []
      setDraft({ models: [...models, { id: '', name: '', contextWindow: '', maxTokens: '' }] })
    }
    const toggleModel = (id) => {
      const models = (store.draft ? store.draft.models : []) || []
      const idx = models.findIndex((m) => m.id === id)
      let next
      if (idx >= 0) {
        next = models.filter((_, i) => i !== idx)
      } else {
        const cap = CAP[id] || []
        next = [...models, { id, name: '', contextWindow: cap[0] !== undefined ? String(cap[0]) : '', maxTokens: cap[1] !== undefined ? String(cap[1]) : '' }]
      }
      setDraft({ models: next })
    }

    // The background model sync writes to the same namespace, so a conflict
    // here is ordinary rather than exceptional: re-read and send again once.
    const callWithRetry = async (method, args) => {
      const withRevision = () => jsonArgs(Object.assign({}, args, {
        revision: store.data ? store.data.revision : undefined,
      }))
      try {
        return await host.call(method, withRevision())
      } catch (e) {
        if (!String((e && e.message) || e).includes('SETTINGS_CONFLICT')) throw e
        if (!(await refresh())) throw e
        return host.call(method, withRevision())
      }
    }
    const saveWithRetry = (args) => callWithRetry('providers.save', args)

    const setImageDefault = async (key) => {
      if (store.data === null) return
      const ops = store.data.providers
        .filter((p) => p.image === true)
        .map((p) => ({ op: 'set', path: ['providers', p.key, 'imageDefault'], value: p.key === key }))
      setState({ busy: true, error: null })
      try {
        await host.call('providers.save', jsonArgs({ ops }))
        await refresh()
        setState({ busy: false, notice: '图片默认路由已设为 ' + key + '（带图发送时自动切换）' })
      } catch (e) {
        setState({ busy: false, error: messageOf(e) })
      }
    }

    const save = async () => {
      const s = store
      const d = s.draft
      if (d === null) return
      const custom = s.editing === null || s.editing.template === null || s.editing.template.declared
      const profile = {}
      if (typeof d.displayName === 'string' && d.displayName.trim()) profile.displayName = d.displayName.trim()
      if (typeof d.apiKeyEnv === 'string' && d.apiKeyEnv.trim()) {
        const ref = d.apiKeyEnv.trim()
        if (!REF.test(ref)) {
          setState({ error: '环境变量名不合法（须为字母/数字/下划线，且不能以数字开头）' })
          return
        }
        profile.apiKeyEnv = ref
      }
      const key = (s.editing !== null && typeof s.editing.key === 'string' ? s.editing.key : '').trim()
      if (!key) {
        setState({ error: '路由 key 不能为空' })
        return
      }
      let modelIds = []
      if (custom) {
        if (!d.api) {
          setState({ error: '请选择 API 协议' })
          return
        }
        if (!d.baseURL || !d.baseURL.trim()) {
          setState({ error: '请填写 BaseURL' })
          return
        }
        profile.api = d.api
        profile.baseURL = d.baseURL.trim()
        if (d.thinkingFormat) profile.compat = { thinkingFormat: d.thinkingFormat }
        if (d.syncModels) profile.syncModels = true
        if (d.image) profile.image = true
        const cleaned = []
        for (const m of (d.models || [])) {
          const id = typeof m.id === 'string' ? m.id.trim() : ''
          if (!id) continue
          const e = { id }
          if (typeof m.name === 'string' && m.name.trim()) e.name = m.name.trim()
          const cw = Number(m.contextWindow)
          const mt = Number(m.maxTokens)
          if (Number.isFinite(cw) && cw > 0) e.contextWindow = cw
          if (Number.isFinite(mt) && mt > 0) e.maxTokens = mt
          cleaned.push(e)
        }
        if (cleaned.length === 0) {
          setState({ error: '至少需要一个模型（点快捷模型、手动填 id，或“自动获取模型”）' })
          return
        }
        profile.models = cleaned
        modelIds = cleaned.map((m) => m.id)
      }
      const apiKey = typeof d.apiKey === 'string' ? d.apiKey : ''
      if (apiKey !== '' && !profile.apiKeyEnv) {
        setState({ error: '填写密钥时必须同时填写环境变量名' })
        return
      }
      setState({ busy: true, error: null, notice: null })
      if (custom && modelIds.length > 0) {
        try {
          const ping = await host.call('providers.ping', jsonArgs({
            baseURL: profile.baseURL,
            api: profile.api,
            apiKey: apiKey !== '' ? apiKey : undefined,
            apiKeyEnv: profile.apiKeyEnv,
            models: modelIds,
          }))
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
      const ops = [{ op: 'set', path: ['providers', key], value: profile }]
      try {
        await saveWithRetry({ ops, apiKey: apiKey !== '' ? apiKey : undefined })
        await refresh()
        setState({ busy: false, view: 'list', editing: null, draft: null, notice: '已保存 ' + key + '（热生效）。同一厂商可再点 + 添加第 2 个 key。' })
      } catch (e) {
        setState({ busy: false, error: messageOf(e) })
      }
    }

    const removeProvider = async (key) => {
      if (store.confirmKey !== key) {
        setState({ confirmKey: key })
        return
      }
      setState({ busy: true, error: null, confirmKey: null })
      try {
        await callWithRetry('providers.remove', { ops: [{ op: 'unset', path: ['providers', key] }] })
        await refresh()
        setState({ busy: false, notice: '已删除 ' + key })
      } catch (e) {
        setState({ busy: false, error: messageOf(e) })
      }
    }

    const HistorySearch = () => {
      const sessions = ctx.get('sessions')
      const [query, setQuery] = React.useState('')
      const [results, setResults] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const abortRef = React.useRef(null)
      const genRef = React.useRef(0)
      const doSearch = (q) => {
        const gen = ++genRef.current
        if (q.trim() === '') {
          setResults(null)
          setOpen(false)
          return
        }
        host.call('search.sessions', { query: q.trim() }).then((res) => {
          if (gen !== genRef.current) return
          if (res !== null && typeof res === 'object' && Array.isArray(res.items)) {
            setResults(res.items)
            setOpen(true)
          } else {
            setResults([])
            setOpen(true)
          }
        }).catch(() => {
          if (gen !== genRef.current) return
          setResults([])
          setOpen(true)
        })
      }
      React.useEffect(() => () => { if (abortRef.current !== null) abortRef.current.abort() }, [])
      return h('div', { className: 'hs-wrap' },
        h('input', { className: 'pp-input hs-input', placeholder: '搜索历史…', value: query,
          onChange: (e) => { const v = e.target.value; setQuery(v); doSearch(v) } }),
        open && results !== null ? h('div', { className: 'hs-drop' },
          results.length === 0
            ? h('div', { className: 'hs-empty' }, '无结果')
            : results.length >= 100 ? h('div', { className: 'hs-empty' }, '结果很多，只显示前 100 条，用更精确的关键词') : null,
          results.length === 0
            ? null
            : results.map((r) => h('button', { type: 'button', key: r.sessionId, className: 'hs-item',
              onClick: () => { if (sessions !== undefined) sessions.open(r.sessionId); setOpen(false) } },
              h('span', { className: 'hs-snippet' }, r.snippet))))
          : null)
    }

    const UploadButton = (props) => {
      const inputRef = React.useRef(null)
      const onChange = (e) => {
        const files = Array.from(e.target.files || [])
        e.target.value = ''
        if (files.length === 0) return
        const conversation = ctx.get('conversation')
        if (conversation === undefined || props.inputActions === undefined) return
        const images = conversation.createDraftImages(files)
        if (images.length > 0 && !props.inputActions.addImages(images.map((i) => i.id))) {
          conversation.releaseDraftImages(images)
        }
      }
      return h('div', { className: 'pp-uploadwrap' },
        h('input', { ref: inputRef, type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onChange }),
        h('button', { type: 'button', className: 'pp-plus pp-upload', title: '从本地选择图片', 'aria-label': '上传图片',
          onClick: () => { if (inputRef.current !== null) inputRef.current.click() } },
          h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
            h('path', { d: 'M8 2.5v11M2.5 8h11', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))))
    }

    const ScreenshotButton = (props) => {
      const [busy, setBusy] = React.useState(false)
      const shoot = async () => {
        if (busy || typeof navigator === 'undefined' || navigator.mediaDevices === undefined
          || navigator.mediaDevices.getDisplayMedia === undefined) {
          setState({ notice: '此浏览器不支持屏幕捕获' })
          return
        }
        setBusy(true)
        let stream
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        } catch (e) {
          setBusy(false)
          return
        }
        try {
          const video = document.createElement('video')
          video.srcObject = stream
          video.muted = true
          await new Promise((res) => { video.onloadedmetadata = () => { video.play().then(res, res) } })
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth || 1280
          canvas.height = video.videoHeight || 720
          canvas.getContext('2d').drawImage(video, 0, 0)
          const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
          if (blob === null) return
          const file = new File([blob], 'screenshot.png', { type: 'image/png' })
          const conversation = ctx.get('conversation')
          if (conversation !== undefined && props.inputActions !== undefined) {
            const images = conversation.createDraftImages([file])
            if (images.length > 0 && !props.inputActions.addImages(images.map((i) => i.id))) {
              conversation.releaseDraftImages(images)
            }
          }
        } finally {
          stream.getTracks().forEach((t) => t.stop())
          setBusy(false)
        }
      }
      return h('button', { type: 'button', className: 'pp-plus pp-shot' + (busy ? ' pp-shot-busy' : ''), title: '截图并插入输入框',
        'aria-label': '截图', onClick: shoot },
        h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
          h('path', { d: 'M3 4.5h2l1-1.5h4l1 1.5h2a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V6A1.5 1.5 0 0 1 3 4.5Zm5 6.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', fill: 'currentColor' })))
    }

    const PlusButton = (props) => {
      const s = useStore()
      const inputActions = props.inputActions
      const sessionId = props.sessionId
      const imageIds = props.useInput !== undefined ? props.useInput((st) => (st ? st.imageIds : [])) : []
      const sessions = ctx.get('sessions')
      const switchedRef = React.useRef(null)
      React.useEffect(() => {
        if (imageIds.length === 0 || sessions === undefined || s.data === null) return
        const imageRoutes = s.data.providers.filter((p) => p.image === true)
        const def = imageRoutes.find((p) => p.imageDefault === true) || imageRoutes[0]
        if (def === undefined || switchedRef.current === sessionId) return
        sessions.models({ sessionId }).then((res) => {
          if (!res.result.ok) return
          const cur = res.result.value.current
          if (cur === null || cur === undefined) return
          if (imageRoutes.some((p) => p.key === cur.provider) || cur.provider === def.key) return
          const model = Array.isArray(def.models) && def.models.length > 0 ? def.models[0].id : undefined
          if (model === undefined) return
          switchedRef.current = sessionId
          sessions.selectModel({ sessionId, provider: def.key, model })
        })
      }, [imageIds.length, sessionId, s.data])
      return h('button', {
        type: 'button',
        className: 'pp-plus',
        'aria-label': '配置 Provider',
        title: '配置模型 Provider（添加/编辑路由、模型与密钥）',
        'data-pp-plus': true,
        onMouseDown: (e) => e.preventDefault(),
        onClick: () => togglePanel(),
      }, h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
        h('path', { d: 'M8 3.2v9.6M3.2 8h9.6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' })))
    }

    const renderList = (s) => {
      const data = s.data
      const rows = []
      if (data !== null) {
        rows.push(h('input', { className: 'pp-input pp-search', key: 'search', placeholder: '搜索厂商 / 模型…', value: s.query || '', onChange: (e) => setState({ query: e.target.value }) }))
      }
      const q = (s.query || '').trim().toLowerCase()
      const all = data !== null && Array.isArray(data.providers) ? data.providers : []
      const visible = q === '' ? all : all.filter((pp) => {
        const hay = (pp.displayName || pp.key) + ' ' + pp.key + ' ' + (Array.isArray(pp.models) ? pp.models.map((m) => m.id).join(' ') : '')
        return hay.toLowerCase().includes(q)
      })
      let shown = 0
      if (data === null) {
        rows.push(h('div', { className: 'pp-hint', key: 'loading' }, s.error ? '加载失败（见下方错误）。' : '加载中…'))
        rows.push(h('button', { type: 'button', className: 'pp-btn', key: 'retry', onClick: () => refresh() }, '重试'))
      } else if (!data.available) {
        rows.push(h('div', { className: 'pp-hint', key: 'na' }, 'llm-pi-ai 适配器未挂载，无法在此配置 Provider。'))
      } else if (data.providers.length === 0) {
        rows.push(h('div', { className: 'pp-hint', key: 'empty' }, '还没有配置 Provider，点下方按钮添加。'))
      }
      for (const p of visible) {
        shown += 1
        const cred = p.credential || {}
        const sub = []
        sub.push(h('span', { key: 'url' }, p.baseURL || '（继承目录端点）'))
        if (p.apiKeyEnv) {
          sub.push(h('span', { className: 'pp-env', key: 'env' }, p.apiKeyEnv + (cred.configured ? ' ✓' : ' ✗')))
        }
        if (Array.isArray(p.models) && p.models.length > 0) {
          const ids = p.models.map((m) => m.id).join('、')
          sub.push(h('span', { className: 'pp-models', key: 'models', title: ids }, ids.length > 40 ? ids.slice(0, 40) + '…' : ids))
        }
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
      if (data !== null) {
        const imgRoutes = data.providers.filter((p) => p.image === true)
        if (imgRoutes.length > 0) {
          const cur = imgRoutes.find((p) => p.imageDefault === true)
          rows.push(h('div', { className: 'pp-defrow', key: 'imgdef' },
            h('span', { className: 'pp-label2' }, '图片默认路由:'),
            h('select', { className: 'pp-input pp-defsel', value: cur ? cur.key : '', onChange: (e) => setImageDefault(e.target.value) },
              imgRoutes.map((p) => h('option', { value: p.key, key: p.key }, p.displayName || p.key)))))
        }
      }
      if (q !== '' && shown === 0) {
        rows.push(h('div', { className: 'pp-hint', key: 'no-match' }, '没有匹配的厂商或模型'))
      }
      rows.push(h('button', { type: 'button', className: 'pp-add', key: 'add', onClick: () => setState({ view: 'picker' }) }, '+ 添加 Provider'))
      rows.push(h('div', { className: 'pp-foot', key: 'foot' }, '保存前自动校验模型名 · 打“自动同步”的路由后台每 60s 与端点对齐'))
      return h('div', { className: 'pp-body' }, rows)
    }

    const renderPicker = (s) => {
      const items = PRESETS.map((p) => h('button', { type: 'button', className: 'pp-tpl', key: p.provider, onClick: () => startAdd(p) },
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

    const renderEdit = (s) => {
      const d = s.draft
      if (d === null) return null
      const custom = s.editing === null || s.editing.template === null || s.editing.template.declared
      const protocols = s.data !== null && Array.isArray(s.data.protocols) ? s.data.protocols : ['openai-completions', 'openai-responses', 'anthropic-messages']
      const formats = s.data !== null && Array.isArray(s.data.thinkingFormats) ? s.data.thinkingFormats : []
      const base = s.editing !== null && s.editing.template !== null && typeof s.editing.template.provider === 'string'
        ? s.editing.template.provider : (s.editing !== null ? s.editing.key : '')
      const known = KNOWN[base] || []
      const field = (label, node, hint) => h('label', { className: 'pp-field' },
        h('span', { className: 'pp-label' }, label),
        node,
        hint ? h('span', { className: 'pp-hint' }, hint) : null)
      const section = (label, node, hint) => h('div', { className: 'pp-field' },
        h('span', { className: 'pp-label' }, label),
        node,
        hint ? h('span', { className: 'pp-hint' }, hint) : null)
      const inputs = []
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
            [h('option', { value: '', key: '' }, '自动'), ...formats.map((f) => h('option', { value: f, key: f }, f))]),
          'openai-completions 方言：GLM=zai，MiniMax=deepseek'))
        inputs.push(section('自动同步模型',
          h('label', { className: 'pp-check' },
            h('input', { type: 'checkbox', checked: d.syncModels === true, onChange: (e) => setDraft({ syncModels: e.target.checked }) }),
            h('span', null, '端点模型列表变化时自动更新本路由的模型（后台每 60s 检查，端点为准）'))))
        inputs.push(section('图片能力',
          h('label', { className: 'pp-check' },
            h('input', { type: 'checkbox', checked: d.image === true, onChange: (e) => setDraft({ image: e.target.checked }) }),
            h('span', null, '该路由的模型支持图片输入（可作“图片默认路由”的候选）'))))
        const chipRow = known.length > 0
          ? h('div', { className: 'pp-chips', key: 'chips' },
            h('span', { className: 'pp-label2' }, '快捷模型：'),
            known.map((id) => h('button', { type: 'button', className: 'pp-chip' + ((d.models || []).some((m) => m.id === id) ? ' pp-chip-on' : ''), key: id, onClick: () => toggleModel(id) }, id)))
          : null
        const modelRows = (d.models || []).map((m, i) => h('div', { className: 'pp-mrow', key: i },
          h('input', { className: 'pp-input pp-mid', value: m.id || '', placeholder: '模型 id', onChange: (e) => updateModel(i, { id: e.target.value }) }),
          h('input', { className: 'pp-input pp-mnum', type: 'number', value: m.contextWindow || '', placeholder: 'ctx', title: 'contextWindow', onChange: (e) => updateModel(i, { contextWindow: e.target.value }) }),
          h('input', { className: 'pp-input pp-mnum', type: 'number', value: m.maxTokens || '', placeholder: 'max', title: 'maxTokens', onChange: (e) => updateModel(i, { maxTokens: e.target.value }) }),
          h('button', { type: 'button', className: 'pp-btn pp-btn-danger pp-mdel', onClick: () => removeModel(i) }, '×')))
        inputs.push(section('模型列表（保存前自动校验模型名；点快捷模型选中/取消）',
          h('div', { className: 'pp-mlist' },
            chipRow,
            modelRows,
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

    const ProviderPanel = () => {
      const s = useStore()
      if (!s.open) return null
      const content = s.view === 'picker' ? renderPicker(s) : s.view === 'edit' ? renderEdit(s) : renderList(s)
      return h('div', { className: 'pp-panel', 'data-pp-panel': true, 'data-pp-version': '9' },
        h('div', { className: 'pp-head' },
          h('span', { className: 'pp-title' }, s.view === 'edit'
            ? (s.editing !== null && s.editing.isNew ? '添加 Provider · v9' : '编辑 Provider · v9')
            : s.view === 'picker' ? '添加 Provider · v9' : 'Provider 配置 · v9'),
          h('button', { type: 'button', className: 'pp-close', 'aria-label': '关闭', onClick: () => closePanel() }, '×')),
        content,
        s.busy ? h('div', { className: 'pp-status' }, '处理中…') : null,
        s.error ? h('div', { className: 'pp-err' }, String(s.error)) : null,
        s.notice ? h('div', { className: 'pp-ok' }, String(s.notice)) : null)
    }

    styles.insert('.pp-plus{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;}.pp-plus:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.pp-panel{position:absolute;right:0;bottom:calc(100% + 8px);z-index:100;width:min(440px,calc(100vw - 48px));max-height:min(66vh,600px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);padding:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;}.pp-head{display:flex;align-items:center;justify-content:space-between;padding:2px 2px 8px;flex:none;}.pp-title{font-weight:600;font-size:14px;}.pp-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;cursor:pointer;line-height:1;padding:2px 8px;border-radius:6px;}.pp-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.pp-body{overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-height:0;}.pp-form{gap:8px;}.pp-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;flex:none;}.pp-row-main{display:flex;flex-direction:column;gap:2px;min-width:0;}.pp-row-title{display:flex;align-items:center;gap:6px;}.pp-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:none;}.pp-dot-ok{background:var(--dsw-alias-state-success-primary);}.pp-dot-no{background:var(--dsw-alias-state-warn-primary);}.pp-name{font-weight:600;}.pp-key{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}.pp-badge{font-size:11px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}.pp-badge-custom{color:var(--dsw-alias-brand-primary);}.pp-row-sub{display:flex;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;flex-wrap:wrap;}.pp-env{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}.pp-models{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;}.pp-row-actions{display:flex;gap:6px;flex:none;}.pp-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;}.pp-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-btn-danger{color:var(--dsw-alias-state-error-primary);}.pp-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600;}.pp-btn:disabled{opacity:.5;cursor:default;}.pp-add{margin-top:4px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-brand-primary);border-radius:10px;padding:8px;cursor:pointer;font-size:13px;flex:none;}.pp-add:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-hint{color:var(--dsw-alias-label-secondary);font-size:12px;}.pp-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px;white-space:pre-wrap;word-break:break-word;flex:none;}.pp-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin-top:6px;flex:none;}.pp-status{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:6px;flex:none;}.pp-foot{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:4px;flex:none;}.pp-field{display:flex;flex-direction:column;gap:4px;flex:none;}.pp-label{font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-label2{font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-input{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 8px;font-size:13px;outline:none;width:100%;box-sizing:border-box;}.pp-input:focus{border-color:var(--dsw-alias-brand-primary);}.pp-input:disabled{opacity:.6;}.pp-actions{display:flex;gap:8px;margin-top:2px;flex:none;flex-wrap:wrap;}.pp-check{display:flex;gap:6px;align-items:center;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;}.pp-picker-head{display:flex;align-items:center;gap:8px;padding-bottom:6px;flex:none;}.pp-title2{font-weight:600;}.pp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}.pp-tpl{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:10px;padding:8px 10px;cursor:pointer;color:var(--dsw-alias-label-primary);}.pp-tpl:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-tpl-name{font-weight:600;font-size:13px;}.pp-tpl-key{font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.pp-tpl-custom{border-style:dashed;}.pp-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}.pp-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 8px;font-size:11px;cursor:pointer;}.pp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);}.pp-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover);}.pp-search{margin-bottom:2px;flex:none;}.pp-shot-busy{opacity:.5;}.pp-defrow{display:flex;align-items:center;gap:6px;flex:none;}.pp-defsel{flex:1 1 auto;width:auto;padding:4px 8px;font-size:12px;}.pp-mlist{display:flex;flex-direction:column;gap:4px;}.hs-wrap{position:relative;flex:none;}.hs-input{width:150px;padding:4px 8px;font-size:12px;}.hs-drop{position:absolute;top:calc(100% + 4px);right:0;z-index:120;min-width:280px;max-width:360px;max-height:320px;overflow-y:auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted);border-radius:10px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);padding:4px;}.hs-item{border:none;background:transparent;text-align:left;border-radius:8px;padding:6px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:normal;}.hs-item:hover{background:var(--dsw-alias-interactive-bg-hover);}.hs-snippet{display:block;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}.hs-empty{padding:6px 8px;font-size:12px;color:var(--dsw-alias-label-secondary);}.pp-mrow{display:flex;gap:4px;align-items:center;}.pp-mid{flex:1 1 auto;}.pp-mnum{flex:0 0 74px;}.pp-mdel{flex:none;}' )

    slots.inject('conversation.session.header.utilities', () => slots.register(
      { name: 'conversation.session.header.utilities', id: 'history-search', order: 1 },
      () => React.createElement(HistorySearch),
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
  },
}
