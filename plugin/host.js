// Provider Quick Config — Host half (code.host of the dynamic Cordis plugin).
// This file is the exact body passed to cordis_define(code.host). It runs in
// the harness's node:vm sandbox: plain JavaScript only, no imports.
// NOTE: never construct objects to pass into `settings.mutate` here — the vm
// realm breaks isPlainObject checks. The Client builds ops and sends them over
// the wire (host-realm JSON); this half only forwards.
return {
  inject: ['timer'],
  apply(ctx) {
    const NS = 'llm-pi-ai'
    const REF = /^[A-Za-z_][A-Za-z0-9_]*$/
    // Resolved per call, not captured at apply: a service that mounts after
    // this plugin would otherwise stay undefined for the process's whole life,
    // and every handler here would degrade silently and never recover. Reading
    // through the accessor keeps the graceful degradation without freezing it.
    const settingsOf = () => ctx.get('settings')
    const credentialsOf = () => ctx.get('credentials')
    const llmOf = () => ctx.get('llm')
    const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
    const VISION = /(gpt-4o|gpt-4\.1|o3\b|o4\b|claude|minicpm|glm-4\.6v|vision|gemini|llava|qwen2\.5-vl)/i
    const THINKING = ['openai', 'deepseek', 'openrouter', 'together', 'zai', 'qwen', 'string-thinking', 'ant-ling']

    function omitUndefined(obj) {
      const out = {}
      for (const key of Object.keys(obj)) {
        const value = obj[key]
        if (value !== undefined) out[key] = value
      }
      return out
    }

    // vm-realm objects fail host isPlainObject checks; null-prototype objects
    // pass (`proto === null`), which is what lets this half write settings
    // directly from the sandbox instead of round-tripping through the Client.
    function plainValue(value) {
      if (Array.isArray(value)) return value.map(plainValue)
      if (value !== null && typeof value === 'object') {
        const out = Object.create(null)
        for (const k of Object.keys(value)) out[k] = plainValue(value[k])
        return out
      }
      return value
    }

    function snapshot() {
      const settings = settingsOf()
      if (settings === undefined) return undefined
      let descriptor
      try {
        descriptor = settings.describe().find((d) => d.ns === NS)
      } catch (e) {
        return undefined
      }
      if (descriptor === undefined) return undefined
      const user = descriptor.user
      const providers = (user !== undefined && typeof user === 'object' && !Array.isArray(user)
        && user.providers !== undefined && typeof user.providers === 'object' && !Array.isArray(user.providers))
        ? user.providers
        : {}
      return { descriptor, providers }
    }

    function directory() {
      const llm = llmOf()
      if (llm === undefined) return []
      try {
        return llm.listConfigurableProviders()
      } catch (e) {
        return []
      }
    }

    async function credentialOf(ref) {
      const credentials = credentialsOf()
      if (credentials === undefined || typeof ref !== 'string' || !REF.test(ref)) {
        return { configured: false, writable: false }
      }
      try {
        const info = await credentials.describe(ref)
        return omitUndefined({ configured: !!info.configured, source: info.source, writable: !!info.writable })
      } catch (e) {
        return { configured: false, writable: false, error: String((e && e.message) || e) }
      }
    }

    async function handleList() {
      void syncAll()
      const snap = snapshot()
      const dir = directory()
      const catalogKeys = new Set(dir.filter((d) => d.declared !== true).map((d) => d.provider))
      const providers = []
      if (snap !== undefined) {
        for (const [key, raw] of Object.entries(snap.providers)) {
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
          const ref = typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv ? raw.apiKeyEnv : undefined
          const models = Array.isArray(raw.models)
            ? raw.models.map((m) => {
              const e = { id: m !== null && typeof m === 'object' && typeof m.id === 'string' ? m.id : '' }
              if (m !== null && typeof m === 'object' && typeof m.name === 'string') e.name = m.name
              if (m !== null && typeof m === 'object' && typeof m.contextWindow === 'number') e.contextWindow = m.contextWindow
              if (m !== null && typeof m === 'object' && typeof m.maxTokens === 'number') e.maxTokens = m.maxTokens
              if (m !== null && typeof m === 'object' && Array.isArray(m.input) && m.input.includes('image')) e.image = true
              return e
            })
            : undefined
          const hasOwnEndpoint = typeof raw.baseURL === 'string' || typeof raw.api === 'string'
            || (Array.isArray(raw.models) && raw.models.length > 0)
          const imageModels = raw.image === true
            ? models
            : (Array.isArray(models) ? models.filter((m) => VISION.test(m.id)) : undefined)
          providers.push(omitUndefined({
            key,
            displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : key,
            apiKeyEnv: ref,
            api: typeof raw.api === 'string' ? raw.api : undefined,
            baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : undefined,
            compat: raw.compat !== undefined && typeof raw.compat === 'object' && typeof raw.compat.thinkingFormat === 'string'
              ? { thinkingFormat: raw.compat.thinkingFormat }
              : undefined,
            models,
            imageModels,
            syncModels: raw.syncModels === true,
            image: raw.image === true,
            imageDefault: raw.imageDefault === true,
            catalog: catalogKeys.has(key) && !hasOwnEndpoint,
            credential: await credentialOf(ref),
          }))
        }
      }
      const settings = settingsOf()
      return {
        available: snap !== undefined,
        writable: settings !== undefined ? !!settings.writable : false,
        revision: snap !== undefined ? snap.descriptor.revision : 0,
        protocols: PROTOCOLS,
        thinkingFormats: THINKING,
        directory: dir.map((d) => ({ provider: d.provider, displayName: d.displayName, declared: d.declared === true })),
        providers,
      }
    }

    async function discoverModels(args) {
      const llm = llmOf()
      const credentials = credentialsOf()
      if (llm === undefined) throw new Error('llm 服务不可用')
      const a = args !== null && typeof args === 'object' ? args : {}
      const request = {}
      if (typeof a.baseURL === 'string' && a.baseURL.trim()) request.baseURL = a.baseURL.trim()
      if (typeof a.api === 'string' && a.api) request.api = a.api
      let apiKey = typeof a.apiKey === 'string' && a.apiKey !== '' ? a.apiKey : undefined
      if (apiKey === undefined && typeof a.apiKeyEnv === 'string' && a.apiKeyEnv && credentials !== undefined) {
        try {
          const resolved = await credentials.resolve(a.apiKeyEnv)
          if (resolved !== undefined) apiKey = resolved.value
        } catch (e) {
          apiKey = undefined
        }
      }
      if (apiKey !== undefined) request.apiKey = apiKey
      return llm.discoverModels(NS, request)
    }

    let syncing = false
    async function syncRoute(key, raw, revision) {
      if (raw === null || typeof raw !== 'object' || raw.syncModels !== true) return
      if (typeof raw.baseURL !== 'string' || !raw.baseURL) return
      if (raw.api !== 'openai-completions' && raw.api !== 'openai-responses') return
      let listed
      try {
        listed = await discoverModels({ baseURL: raw.baseURL, api: raw.api, apiKeyEnv: raw.apiKeyEnv })
      } catch (e) {
        return
      }
      if (!Array.isArray(listed) || listed.length === 0) return
      const configuredModels = Array.isArray(raw.models) ? raw.models : []
      const configuredIds = new Set(configuredModels.map((m) => m && m.id))
      const discoveredIds = new Set(listed.map((m) => m.id))
      if (configuredIds.size === discoveredIds.size && [...configuredIds].every((id) => discoveredIds.has(id))) return
      const existing = new Map(configuredModels.map((m) => [m && m.id, m]))
      const newModels = listed.map((m) => {
        // Start from what the user wrote, so a field this sync does not know
        // about — reasoningEfforts, above all — survives it. Rebuilding the
        // entry from a fixed list of keys would delete those silently, and a
        // silent deletion of configuration is worse than a stale model list.
        const old = existing.get(m.id)
        const e = old !== undefined && old !== null && typeof old === 'object'
          ? Object.assign({}, old, { id: m.id })
          : { id: m.id }
        if (e.name === undefined && typeof m.name === 'string' && m.name) e.name = m.name
        if (typeof e.contextWindow !== 'number' && typeof m.contextWindow === 'number') e.contextWindow = m.contextWindow
        if (typeof e.maxTokens !== 'number' && typeof m.maxTokens === 'number') e.maxTokens = m.maxTokens
        return e
      })
      const op = plainValue({ op: 'set', path: ['providers', key, 'models'], value: newModels })
      const settings = settingsOf()
      if (settings === undefined) return
      try {
        await settings.mutate(NS, [op], revision)
      } catch (e) {
        // conflict or transient failure: try again on the next tick
      }
    }

    async function syncAll() {
      if (syncing || settingsOf() === undefined || llmOf() === undefined) return
      syncing = true
      try {
        const first = snapshot()
        if (first === undefined) return
        for (const key of Object.keys(first.providers)) {
          // Re-read before each route: revision is a monotonic counter over the
          // whole namespace, so the write that just landed moved it. Reusing
          // the opening snapshot's number makes every route after the first
          // fail SETTINGS_CONFLICT — silently, because syncRoute swallows it.
          const snap = snapshot()
          if (snap === undefined) return
          const raw = snap.providers[key]
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
          if (raw.syncModels !== true) continue
          await syncRoute(key, raw, snap.descriptor.revision)
        }
      } catch (e) {
        // never let a sync failure take the plugin down
      } finally {
        syncing = false
      }
    }

    async function handleDiscover(args) {
      const models = await discoverModels(args)
      return models.map((m) => omitUndefined({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
      }))
    }

    async function handlePing(args) {
      const a = args !== null && typeof args === 'object' ? args : {}
      const ids = Array.isArray(a.models) ? a.models.filter((m) => typeof m === 'string' && m !== '') : []
      if (ids.length === 0) return { status: 'ok' }
      let listed
      try {
        listed = await discoverModels(args)
      } catch (e) {
        return { status: 'unavailable', message: String((e && e.message) || e) }
      }
      if (!Array.isArray(listed) || listed.length === 0) {
        return { status: 'unavailable', message: '端点没有返回模型列表' }
      }
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const valid = new Set(listed.map((m) => norm(m.id)))
      const missing = ids.filter((id) => !valid.has(norm(id)))
      if (missing.length > 0) return { status: 'missing', missing }
      return { status: 'ok' }
    }

    async function handleSave(args) {
      const a = args !== null && typeof args === 'object' ? args : {}
      const settings = settingsOf()
      const credentials = credentialsOf()
      if (settings === undefined) throw new Error('settings 服务不可用')
      const ops = Array.isArray(a.ops) ? a.ops : []
      if (ops.length === 0 || ops.some((op) => op === null || typeof op !== 'object'
        || (op.op !== 'set' && op.op !== 'unset') || !Array.isArray(op.path))) {
        throw new Error('providers.save: 需要至少一条 { op: "set"|"unset", path } op')
      }
      const revision = typeof a.revision === 'number' ? a.revision : undefined
      await settings.mutate(NS, ops, revision)
      const setOp = ops.find((op) => op.op === 'set' && op.value !== undefined)
      const profile = setOp !== undefined ? setOp.value : {}
      const apiKey = typeof a.apiKey === 'string' ? a.apiKey : ''
      const ref = profile !== null && typeof profile === 'object' && typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined
      if (apiKey !== '' && ref !== undefined) {
        if (credentials === undefined) throw new Error('路由已保存；credentials 服务不可用，密钥未写入')
        try {
          await credentials.set(ref, apiKey)
        } catch (e) {
          throw new Error('路由已保存；密钥写入失败: ' + String((e && e.message) || e))
        }
      }
      return { ok: true }
    }

    async function handleRemove(args) {
      const a = args !== null && typeof args === 'object' ? args : {}
      const settings = settingsOf()
      if (settings === undefined) throw new Error('settings 服务不可用')
      const ops = Array.isArray(a.ops) ? a.ops : []
      if (ops.length !== 1 || ops[0] === null || typeof ops[0] !== 'object'
        || ops[0].op !== 'unset' || !Array.isArray(ops[0].path)) {
        throw new Error('providers.remove: 需要一条 unset op')
      }
      const revision = typeof a.revision === 'number' ? a.revision : undefined
      await settings.mutate(NS, ops, revision)
      return { ok: true }
    }

    async function handleSearchSessions(args) {
      const sessionQuery = ctx.get('sessionQuery')
      if (sessionQuery === undefined) throw new Error('sessionQuery 服务不可用（未装 session-query 插件）')
      const a = args !== null && typeof args === 'object' ? args : {}
      const query = typeof a.query === 'string' && a.query.trim() ? a.query.trim() : ''
      if (query === '') return { items: [], hasMore: false }
      const eventFilters = [
        { kind: 'type', values: ['user/message', 'assistant/message'] },
        { kind: 'surface', values: ['current'] },
      ]
      const items = []
      const seen = new Set()
      let cursor
      for (;;) {
        const request = { query, eventFilters, limit: 100 }
        if (cursor !== undefined) request.cursor = cursor
        const page = await sessionQuery.searchSessions(request)
        for (const hit of (page.items || [])) {
          if (hit === null || typeof hit !== 'object') continue
          const id = hit.header !== null && typeof hit.header === 'object' ? hit.header.id : undefined
          const snip = hit.bestMatch !== null && typeof hit.bestMatch === 'object' ? hit.bestMatch.snippet : undefined
          if (typeof id === 'string' && typeof snip === 'string' && !seen.has(id)) {
            seen.add(id)
            items.push({ sessionId: id, snippet: snip.slice(0, 240) })
          }
        }
        if (!page.hasMore || page.nextCursor === undefined || items.length >= 100) break
        cursor = page.nextCursor
      }
      return { items, hasMore: items.length >= 100 }
    }

    async function handleCredentialSet(args) {
      const ref = args !== null && typeof args === 'object' && typeof args.ref === 'string' ? args.ref : ''
      const value = args !== null && typeof args === 'object' && typeof args.value === 'string' ? args.value : ''
      if (!REF.test(ref)) throw new Error('凭据引用名不合法（须为环境变量名）')
      if (value === '') throw new Error('密钥不能为空')
      const credentials = credentialsOf()
      if (credentials === undefined) throw new Error('credentials 服务不可用')
      await credentials.set(ref, value)
      return { ok: true }
    }

    async function handleCredentialUnset(args) {
      const ref = args !== null && typeof args === 'object' && typeof args.ref === 'string' ? args.ref : ''
      if (!REF.test(ref)) throw new Error('凭据引用名不合法（须为环境变量名）')
      const credentials = credentialsOf()
      if (credentials === undefined) throw new Error('credentials 服务不可用')
      await credentials.unset(ref)
      return { ok: true }
    }

    ctx.effect(() => harness.handle('search.sessions', handleSearchSessions))
    ctx.effect(() => harness.handle('providers.list', handleList))
    ctx.effect(() => harness.handle('providers.discover', handleDiscover))
    ctx.effect(() => harness.handle('providers.ping', handlePing))
    ctx.effect(() => harness.handle('providers.save', handleSave))
    ctx.effect(() => harness.handle('providers.remove', handleRemove))
    ctx.effect(() => harness.handle('credentials.set', handleCredentialSet))
    ctx.effect(() => harness.handle('credentials.unset', handleCredentialUnset))

    // Background auto-sync: every 60s compare sync-marked routes' models with
    // their endpoints and write back on change (fiber disposer = cleanup).
    // Callback first: `interval(delay)` is the other overload and returns an
    // async iterator, so the argument order decides whether this runs at all.
    ctx.effect(() => ctx.interval(() => { void syncAll() }, 60000))
    void syncAll()
  },
}
