// Provider Quick Config — Host half（正式安装形态）
// 运行在真实 Cordis 进程里（不是 vm 沙箱）：直接操作 ctx.settings / ctx.credentials / ctx.llm，
// 没有 realm 陷阱，结构化数据可以直接传。客户端（+按钮/面板）通过 connection.api 走 wire。
// 本 Host 只负责一件事：syncModels 标记路由的本地模型后台自动同步（60s 对比端点 /models 写回）。
'use strict'

module.exports = {
  name: 'provider-quick-config',
  // ctx.interval is mixed onto ctx by the timer service, and a mixin accessor
  // throws `cannot get property "timer" without inject` rather than resolving
  // to undefined. ctx.get('settings'|'credentials'|'llm') is the other kind —
  // it returns undefined when unprovided — which is why only timer is declared
  // here and the rest stay optional.
  inject: ['timer'],
  apply(ctx) {
    const NS = 'llm-pi-ai'
    // Resolved per call, not captured at apply: a service that mounts after
    // this plugin would otherwise stay undefined for the process's whole life,
    // and the sync would degrade silently and never recover.
    const settingsOf = () => ctx.get('settings')
    const credentialsOf = () => ctx.get('credentials')
    const llmOf = () => ctx.get('llm')

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

    async function discoverModels(baseURL, api, apiKeyEnv) {
      const llm = llmOf()
      const credentials = credentialsOf()
      if (llm === undefined) throw new Error('llm 服务不可用')
      const request = { baseURL, ...(api === undefined ? {} : { api }) }
      if (apiKeyEnv !== undefined && credentials !== undefined) {
        try {
          const resolved = await credentials.resolve(apiKeyEnv)
          if (resolved !== undefined) request.apiKey = resolved.value
        } catch (e) {
          /* keep unauthenticated probe */
        }
      }
      return llm.discoverModels(NS, request)
    }

    let syncing = false
    async function syncRoute(key, raw, revision) {
      if (raw === null || typeof raw !== 'object' || raw.syncModels !== true) return
      if (typeof raw.baseURL !== 'string' || !raw.baseURL) return
      if (raw.api !== 'openai-completions' && raw.api !== 'openai-responses') return
      let listed
      try {
        listed = await discoverModels(raw.baseURL, raw.api, raw.apiKeyEnv)
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
        // about — reasoningEfforts, above all — survives it. Rebuilding from a
        // fixed list of keys would delete those silently.
        const old = existing.get(m.id)
        const e = old !== undefined && old !== null && typeof old === 'object'
          ? Object.assign({}, old, { id: m.id })
          : { id: m.id }
        if (e.name === undefined && typeof m.name === 'string' && m.name) e.name = m.name
        if (typeof e.contextWindow !== 'number' && typeof m.contextWindow === 'number') e.contextWindow = m.contextWindow
        if (typeof e.maxTokens !== 'number' && typeof m.maxTokens === 'number') e.maxTokens = m.maxTokens
        return e
      })
      const settings = settingsOf()
      if (settings === undefined) return
      try {
        await settings.mutate(NS, [{ op: 'set', path: ['providers', key, 'models'], value: newModels }], revision)
      } catch (e) {
        // conflict / transient: retry next tick
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
          // whole namespace, so the write that just landed moved it. Reusing the
          // opening snapshot's number makes every route after the first fail
          // SETTINGS_CONFLICT — silently, because syncRoute swallows it.
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

    // ---- 读图能力自动测试：给每个模型发 1px 测试图，能回 OK 的标记 image: true ----
    const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    async function probeModel(key, raw, model, revision) {
      if (raw === null || typeof raw !== 'object' || typeof raw.baseURL !== 'string' || !raw.baseURL) return
      const api = raw.api === 'openai-responses' ? 'openai-responses' : 'openai-completions'
      let apiKey
      if (typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv && credentials !== undefined) {
        try {
          const resolved = await credentials.resolve(raw.apiKeyEnv)
          if (resolved !== undefined) apiKey = resolved.value
        } catch (e) { /* probe unauthenticated */ }
      }
      const url = raw.baseURL.replace(/\/+$/, '') + '/chat/completions'
      const body = JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'OK' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG_1PX } },
        ] }],
        max_tokens: 1,
      })
      let ok = false
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json' }, apiKey === undefined ? {} : { authorization: 'Bearer ' + apiKey }),
          body,
        })
        if (res.ok) {
          const text = await res.text()
          ok = text.indexOf('"choices"') >= 0 && text.indexOf('"finish_reason":"length"') < 0
        }
      } catch (e) {
        ok = false
      }
      if (!ok) return
      if (Array.isArray(model.input) && model.input.indexOf('image') >= 0) return
      // 自动配置：把 schema 认可的 input: [text, image] 写进模型条目，适配器即按可读图处理
      try {
        await settings.mutate(NS, [{ op: 'set', path: ['providers', key, 'models', model.index, 'input'], value: ['text', 'image'] }], revision)
      } catch (e) { /* next cycle retries */ }
    }
    async function probeAll() {
      if (settings === undefined || credentials === undefined) return
      const snap = snapshot()
      if (snap === undefined) return
      for (const [key, raw] of Object.entries(snap.providers)) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
        const models = Array.isArray(raw.models) ? raw.models : []
        for (let i = 0; i < Math.min(models.length, 5); i++) {
          const m = models[i]
          if (m === null || typeof m !== 'object' || typeof m.id !== 'string') continue
          if (m.image === true) continue
          await probeModel(key, raw, { id: m.id, index: i, input: m.input }, snap.descriptor.revision)
        }
      }
    }

    // 后台自动同步；ctx.setInterval 是 fiber 作用域定时器，插件卸载自动清理。
    // 读图能力：启动时测一轮写表（input: [text, image]），之后配置即表，不重复测。
    void probeAll()
    ctx.interval(() => { void syncAll() }, 60000)
    void syncAll()
  },
}
