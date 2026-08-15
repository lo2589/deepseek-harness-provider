// Provider Quick Config — Host half（正式安装形态）
// 运行在真实 Cordis 进程里（不是 vm 沙箱）：直接操作 ctx.settings / ctx.credentials / ctx.llm，
// 没有 realm 陷阱，结构化数据可以直接传。客户端（+按钮/面板）通过 connection.api 走 wire。
// 本 Host 只负责一件事：syncModels 标记路由的本地模型后台自动同步（60s 对比端点 /models 写回）。
'use strict'

module.exports = {
  name: 'provider-quick-config',
  apply(ctx) {
    const NS = 'llm-pi-ai'
    const settings = ctx.get('settings')
    const credentials = ctx.get('credentials')
    const llm = ctx.get('llm')

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

    async function discoverModels(baseURL, api, apiKeyEnv) {
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
        const old = existing.get(m.id)
        const e = { id: m.id }
        if (old !== undefined && typeof old.name === 'string' && old.name) e.name = old.name
        else if (typeof m.name === 'string' && m.name) e.name = m.name
        if (old !== undefined && typeof old.contextWindow === 'number') e.contextWindow = old.contextWindow
        else if (typeof m.contextWindow === 'number') e.contextWindow = m.contextWindow
        if (old !== undefined && typeof old.maxTokens === 'number') e.maxTokens = old.maxTokens
        else if (typeof m.maxTokens === 'number') e.maxTokens = m.maxTokens
        return e
      })
      try {
        await settings.mutate(NS, [{ op: 'set', path: ['providers', key, 'models'], value: newModels }], revision)
      } catch (e) {
        // conflict / transient: retry next tick
      }
    }

    async function syncAll() {
      if (syncing || settings === undefined || llm === undefined) return
      syncing = true
      try {
        const snap = snapshot()
        if (snap === undefined) return
        for (const [key, raw] of Object.entries(snap.providers)) {
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

    // 后台自动同步；ctx.setInterval 是 fiber 作用域定时器，插件卸载自动清理。
    ctx.interval(() => { void syncAll() }, 60000)
    void syncAll()
  },
}
