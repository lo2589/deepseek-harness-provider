// Provider Quick Config — Host half (code.host of the dynamic Cordis plugin).
// This file is the exact body passed to cordis_define(code.host). It runs in
// the harness's node:vm sandbox: plain JavaScript only, no imports.
// NOTE: never construct objects to pass into `settings.mutate` here — the vm
// realm breaks isPlainObject checks. The Client builds ops and sends them over
// the wire (host-realm JSON); this half only forwards.
return {
  apply(ctx) {
    const NS = 'llm-pi-ai'
    const REF = /^[A-Za-z_][A-Za-z0-9_]*$/
    const settings = ctx.get('settings')
    const credentials = ctx.get('credentials')
    const llm = ctx.get('llm')
    const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
    const THINKING = ['openai', 'deepseek', 'openrouter', 'together', 'zai', 'qwen', 'string-thinking', 'ant-ling']

    function omitUndefined(obj) {
      const out = {}
      for (const key of Object.keys(obj)) {
        const value = obj[key]
        if (value !== undefined) out[key] = value
      }
      return out
    }

    function snapshot() {
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
      if (llm === undefined) return []
      try {
        return llm.listConfigurableProviders()
      } catch (e) {
        return []
      }
    }

    async function credentialOf(ref) {
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
              return e
            })
            : undefined
          const hasOwnEndpoint = typeof raw.baseURL === 'string' || typeof raw.api === 'string'
            || (Array.isArray(raw.models) && raw.models.length > 0)
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
            catalog: catalogKeys.has(key) && !hasOwnEndpoint,
            credential: await credentialOf(ref),
          }))
        }
      }
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
      if (settings === undefined) throw new Error('settings 服务不可用')
      const ops = Array.isArray(a.ops) ? a.ops : []
      if (ops.length !== 1 || ops[0] === null || typeof ops[0] !== 'object'
        || ops[0].op !== 'set' || !Array.isArray(ops[0].path) || ops[0].value === undefined) {
        throw new Error('providers.save: 需要一条 set op（{ op: "set", path, value }）')
      }
      const revision = typeof a.revision === 'number' ? a.revision : undefined
      await settings.mutate(NS, ops, revision)
      const profile = ops[0].value
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

    async function handleCredentialSet(args) {
      const ref = args !== null && typeof args === 'object' && typeof args.ref === 'string' ? args.ref : ''
      const value = args !== null && typeof args === 'object' && typeof args.value === 'string' ? args.value : ''
      if (!REF.test(ref)) throw new Error('凭据引用名不合法（须为环境变量名）')
      if (value === '') throw new Error('密钥不能为空')
      if (credentials === undefined) throw new Error('credentials 服务不可用')
      await credentials.set(ref, value)
      return { ok: true }
    }

    async function handleCredentialUnset(args) {
      const ref = args !== null && typeof args === 'object' && typeof args.ref === 'string' ? args.ref : ''
      if (!REF.test(ref)) throw new Error('凭据引用名不合法（须为环境变量名）')
      if (credentials === undefined) throw new Error('credentials 服务不可用')
      await credentials.unset(ref)
      return { ok: true }
    }

    ctx.effect(() => harness.handle('providers.list', handleList))
    ctx.effect(() => harness.handle('providers.discover', handleDiscover))
    ctx.effect(() => harness.handle('providers.ping', handlePing))
    ctx.effect(() => harness.handle('providers.save', handleSave))
    ctx.effect(() => harness.handle('providers.remove', handleRemove))
    ctx.effect(() => harness.handle('credentials.set', handleCredentialSet))
    ctx.effect(() => harness.handle('credentials.unset', handleCredentialUnset))
  },
}
