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
      const settings = settingsOf()
      const credentials = credentialsOf()
      if (settings === undefined || credentials === undefined) return
      const api = raw.api === 'openai-responses' ? 'openai-responses' : 'openai-completions'
      let apiKey
      if (typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv) {
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
          // 端点接受了图片请求（返回 choices）即视为可读图；finish_reason 不影响能力判定
          // （minicpm 等模型对图片常返回 length/空内容，但接受图片本身就是信号）
          const text = await res.text()
          ok = text.indexOf('"choices"') >= 0
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

    // ---- 媒体展示台：监听会话消息，收集提到 / 生成的图片、视频、录音 ----
    // 数据不进模型上下文（对话里只是一段文本或工具产物），但"提到了就展示"：
    // 从 user/message、assistant/message 的文本块里提取媒体文件名（支持相对工作目录路径），
    // 按会话缓存条目；webServer 提供两个同源接口：
    //   GET /plugins/provider-quick-config/media-list?session=<id>  → 条目列表 JSON
    //   GET /plugins/provider-quick-config/media?session=<id>&p=<abs> → 文件内容（仅已缓存条目）
    const MEDIA_EXT = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
      '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
    }
    const MEDIA_RE = /[\w@\u4e00-\u9fa5\- ]+\.(?:png|jpe?g|gif|webp|bmp|svg|ico|mp4|webm|mov|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)/gi
    // 同一会话内按"规范化路径"去重，保留首次出现顺序
    const mediaBySession = new Map()
    function normPath(p) {
      return String(p || '').replace(/\/+/g, '/').replace(/\/$/, '')
    }
    function mediaKind(ext) {
      const mime = MEDIA_EXT[ext] || ''
      if (mime.startsWith('image/')) return 'image'
      if (mime.startsWith('video/')) return 'video'
      if (mime.startsWith('audio/')) return 'audio'
      return 'other'
    }
    async function resolveMediaPath(session, raw) {
      let t = String(raw || '').trim()
      if (t === '') return undefined
      if (t.startsWith('~')) {
        try { t = t.replace(/^~/, process.env.HOME || '') } catch (e) {}
      }
      const cwd = session !== undefined && session !== null && typeof session.header === 'object' && typeof session.header.cwd === 'string'
        ? session.header.cwd.replace(/\/+$/, '') : undefined
      const candidates = []
      if (t.startsWith('/')) {
        candidates.push(t)
      } else if (/^[A-Za-z]:\//.test(t)) {
        candidates.push(t)
      } else if (cwd !== undefined) {
        // 整段作为相对路径试一次
        candidates.push(cwd + '/' + t)
        // 中文描述 + 文件名（如“仅文件名 pic.jpg”）：回退到最后一段纯文件名
        const tail = t.split(/[\s/\\]+/).pop()
        if (tail !== undefined && tail !== t && /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|mp4|webm|mov|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(tail)) {
          candidates.push(cwd + '/' + tail)
        }
      }
      for (const c of candidates) {
        try {
          const fs = fsOf()
          if (fs === undefined) return undefined
          const target = await fs.resolve(c)
          const info = await fs.stat(target)
          if (info !== undefined && info.type === 'file' && info.size > 0) return { path: c, size: info.size }
        } catch (e) { /* try next candidate */ }
      }
      return undefined
    }
    function fsOf() { return ctx.get('fs') }
    function extractMedia(session, blocks) {
      if (!Array.isArray(blocks)) return []
      const out = []
      for (const b of blocks) {
        if (b === null || typeof b !== 'object') continue
        if (b.type === 'text' && typeof b.text === 'string') {
          const matches = Array.from(b.text.matchAll(MEDIA_RE))
          if (matches.length === 0) continue
          for (const m of matches) {
            const token = m[0]
            const lower = token.toLowerCase()
            const lastDot = lower.lastIndexOf('.')
            if (lastDot < 0) continue
            const ext = lower.slice(lastDot)
            if (MEDIA_EXT[ext] === undefined) continue
            // 向左回溯：token 前若紧跟路径片段（含 / ~ : . 和中文/字母），并入候选
            const before = b.text.slice(0, m.index)
            let start = before.length
            while (start > 0) {
              const ch = before[start - 1]
              if (/[\w@\u4e00-\u9fa5\-]/.test(ch) || ch === '/' || ch === '\\' || ch === '~' || ch === '.' || ch === ':') start--
              else break
            }
            let raw = before.slice(start) + token
            // 去掉常见标点残留
            raw = raw.replace(/^[.,，。、;；:：""''()（）\s]+/, '')
            if (raw === '') raw = token
            out.push({ raw, ext })
          }
        }
      }
      return out
    }
    async function ingestSessionEvent(session, event) {
      if (session === undefined || event === undefined || typeof event !== 'object') return
      const type = event.type
      const data = event.data
      if (data === null || typeof data !== 'object') return
      const blocks = type === 'user/message' && Array.isArray(data.content)
        ? data.content
        : type === 'assistant/message' && data.message !== null && typeof data.message === 'object' && Array.isArray(data.message.content)
          ? data.message.content
          : undefined
      if (blocks === undefined) return
      const sid = typeof session.id === 'string' ? session.id : (typeof session.header === 'object' ? session.header.id : undefined)
      if (sid === undefined) return
      const found = extractMedia(session, blocks)
      if (found.length === 0) return
      let list = mediaBySession.get(sid)
      if (list === undefined) { list = []; mediaBySession.set(sid, list) }
      let changed = false
      for (const f of found) {
        const resolved = await resolveMediaPath(session, f.raw)
        if (resolved === undefined) continue
        const key = normPath(resolved.path)
        if (list.some((x) => x.path === key)) continue
        list.push({ path: key, name: f.raw.split('/').pop(), ext: f.ext, kind: mediaKind(f.ext), size: resolved.size })
        changed = true
      }
      if (changed && mediaBySession.size > 200) {
        // 防内存膨胀：超过 200 个会话时清掉最旧的
        const first = mediaBySession.keys().next().value
        mediaBySession.delete(first)
      }
    }
    function webServerOf() { return ctx.get('webServer') }
    function attachMediaRoutes() {
      const server = webServerOf()
      if (server === undefined || typeof server.register !== 'function') return
      // 列表接口：?session=<id>
      const listDisposer = server.register({
        kind: 'exact',
        path: '/plugins/provider-quick-config/media-list',
        handler: async (req, res) => {
          let sid = ''
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            sid = u.searchParams.get('session') || ''
          } catch (e) {}
          const list = sid !== '' ? (mediaBySession.get(sid) || []) : []
          const body = JSON.stringify({ items: list })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(body)
        },
      })
      // 文件接口：?session=<id>&p=<绝对路径>（仅已缓存条目，防目录穿越任意读）
      const fileDisposer = server.register({
        kind: 'exact',
        path: '/plugins/provider-quick-config/media',
        handler: async (req, res) => {
          let sid = ''
          let p = ''
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            sid = u.searchParams.get('session') || ''
            p = u.searchParams.get('p') || ''
          } catch (e) {}
          const list = sid !== '' ? (mediaBySession.get(sid) || []) : []
          const key = normPath(p)
          const entry = list.find((x) => x.path === key)
          if (entry === undefined) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('not-found')
            return
          }
          const mime = MEDIA_EXT[entry.ext] || 'application/octet-stream'
          try {
            const fs = fsOf()
            if (fs === undefined) throw new Error('fs unavailable')
            const target = await fs.resolve(entry.path)
            const info = await fs.stat(target)
            if (info === undefined || info.type !== 'file') throw new Error('not a file')
            // 流式返回（视频/录音可能很大）；不设 Content-Length 走 chunked
            res.writeHead(200, {
              'content-type': mime,
              'accept-ranges': 'bytes',
              'cache-control': 'private, max-age=60',
              'x-content-type-options': 'nosniff',
            })
            // fs.readBytes 有上限，这里直接用 node 的 fs 流；profile 进程里 node:fs 可用
            const nodeFs = require('node:fs')
            const nodePath = require('node:path')
            const abs = nodePath.resolve(entry.path)
            const stream = nodeFs.createReadStream(abs)
            stream.on('error', () => { res.destroy() })
            stream.pipe(res)
          } catch (e) {
            if (!res.headersSent) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('unavailable')
            } else {
              res.destroy()
            }
          }
        },
      })
      return () => { try { listDisposer() } catch (e) {} try { fileDisposer() } catch (e) {} }
    }

    // 后台自动同步；ctx.setInterval 是 fiber 作用域定时器，插件卸载自动清理。
    // 读图能力：启动时测一轮写表（input: [text, image]），之后配置即表，不重复测。
    const disposeMediaRoutes = attachMediaRoutes()
    const disposeSessionListener = ctx.on('session/event', (session, event) => { void ingestSessionEvent(session, event) })
    ctx.effect(() => {
      return () => {
        try { if (disposeMediaRoutes !== undefined) disposeMediaRoutes() } catch (e) {}
        try { if (disposeSessionListener !== undefined) disposeSessionListener() } catch (e) {}
      }
    })
    // 启动回填：对当前活跃会话先扫一遍已有历史，让"提到过"的媒体立刻出现在展示台
    async function backfillMedia() {
      try {
        const sessionsSvc = ctx.get('sessions')
        if (sessionsSvc === undefined || typeof sessionsSvc.list !== 'function') return
        const all = sessionsSvc.list()
        if (!Array.isArray(all)) return
        for (const s of all) {
          try {
            if (s === undefined || s === null || typeof s.deriveMessages !== 'function') continue
            const messages = s.deriveMessages()
            if (!Array.isArray(messages)) continue
            for (const msg of messages) {
              if (msg === null || typeof msg !== 'object' || !Array.isArray(msg.content)) continue
              await ingestSessionEvent(s, { type: msg.role === 'user' ? 'user/message' : 'assistant/message', data: msg })
            }
          } catch (e) { /* one session must not break the sweep */ }
        }
      } catch (e) { /* backfill best-effort */ }
    }
    void backfillMedia()
    void probeAll()
    ctx.interval(() => { void syncAll() }, 60000)
    void syncAll()
  },
}
