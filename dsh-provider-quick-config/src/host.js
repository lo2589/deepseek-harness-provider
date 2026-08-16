// Provider Quick Config — Host half（正式安装形态）
// 运行在真实 Cordis 进程里（不是 vm 沙箱）：直接操作 ctx.settings / ctx.credentials / ctx.llm，
// 没有 realm 陷阱，结构化数据可以直接传。客户端（+按钮/面板）通过 connection.api 走 wire。
// 本 Host 只负责一件事：syncModels 标记路由的本地模型后台自动同步（60s 对比端点 /models 写回）。
'use strict'

module.exports = {
  name: 'provider-quick-config',
  // ctx.interval is mixed onto ctx by the timer service, and a mixin accessor
  // throws `cannot get property "timer" without inject` rather than resolving
  // to undefined. ctx.get('settings'|'credentials'|'llm'|'webServer') is the
  // other kind — it returns undefined when unprovided — which is why only
  // timer and webServer are declared here and the rest stay optional.
  // webServer 必须硬依赖：bundle 加载早于 webServer 服务，声明后 Cordis 会等
  // webServer 出现再 apply，媒体展示台的路由才能注册成功。
  inject: ['timer', 'webServer'],
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

    // ---- 媒体展示台：扫描式（不依赖事件监听，无 scope 限制）----
    // 数据不进模型上下文；"提到了就展示"：client 拉会话历史 → host 用 sessionQuery
    // 读该会话 cwd + 全部事件 → 提取媒体文件名（支持相对工作目录路径）→ fs 校验 → 返回。
    // webServer 提供两个同源接口：
    //   GET /plugins/provider-quick-config/media-list?session=<id>  → 扫描该会话返回条目 JSON
    //   GET /plugins/provider-quick-config/media?p=<abs>            → 文件内容（扩展名白名单）
    const MEDIA_EXT = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
      '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
    }
    const MEDIA_RE = /[\w@\u4e00-\u9fa5\- ]+\.(?:png|jpe?g|gif|webp|bmp|svg|ico|mp4|webm|mov|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)/gi
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
    function fsOf() { return ctx.get('fs') }
    function queryOf(rawUrl) {
      const out = {}
      const q = String(rawUrl || '').split('?')[1]
      if (q === undefined) return out
      for (const pair of q.split('&')) {
        const eq = pair.indexOf('=')
        if (eq < 0) continue
        const k = pair.slice(0, eq)
        const v = pair.slice(eq + 1)
        try { out[decodeURIComponent(k)] = decodeURIComponent(v) } catch (e) { out[k] = v }
      }
      return out
    }
    function extractMediaFromText(text) {
      if (typeof text !== 'string') return []
      const out = []
      const matches = Array.from(text.matchAll(MEDIA_RE))
      for (const m of matches) {
        const token = m[0]
        const lower = token.toLowerCase()
        const lastDot = lower.lastIndexOf('.')
        if (lastDot < 0) continue
        const ext = lower.slice(lastDot)
        if (MEDIA_EXT[ext] === undefined) continue
        // 向左回溯：token 前若紧跟路径片段（含 / ~ : . 和中文/字母），并入候选
        const before = text.slice(0, m.index)
        let start = before.length
        while (start > 0) {
          const ch = before[start - 1]
          if (/[\w@\u4e00-\u9fa5\-]/.test(ch) || ch === '/' || ch === '\\' || ch === '~' || ch === '.' || ch === ':') start--
          else break
        }
        let raw = before.slice(start) + token
        raw = raw.replace(/^[.,，。、;；:：""''()（）\s]+/, '')
        if (raw === '') raw = token
        out.push({ raw, ext })
      }
      return out
    }
    async function resolveWithCwd(cwd, raw) {
      let t = String(raw || '').trim()
      if (t === '') return undefined
      if (t.startsWith('~')) {
        try { t = t.replace(/^~/, process.env.HOME || '') } catch (e) {}
      }
      const candidates = []
      if (t.startsWith('/')) {
        candidates.push(t)
      } else if (/^[A-Za-z]:\//.test(t)) {
        candidates.push(t)
      } else if (cwd !== undefined && cwd !== '') {
        const c = cwd.replace(/\/+$/, '')
        // 整段作为相对路径试一次
        candidates.push(c + '/' + t)
        // 中文描述 + 文件名（如“仅文件名 pic.jpg”）：回退到最后一段纯文件名
        const tail = t.split(/[\s/\\]+/).pop()
        if (tail !== undefined && tail !== t && /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|mp4|webm|mov|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(tail)) {
          candidates.push(c + '/' + tail)
        }
      }
      const fsSvc = fsOf()
      if (fsSvc === undefined) return undefined
      for (const c of candidates) {
        try {
          const target = await fsSvc.resolve(c)
          const info = await fsSvc.stat(target)
          if (info !== undefined && info.type === 'file' && info.size > 0) {
            const lower = c.toLowerCase()
            const lastDot = lower.lastIndexOf('.')
            const ext = lastDot >= 0 ? lower.slice(lastDot) : ''
            return { path: normPath(c), name: c.split('/').pop(), ext, kind: mediaKind(ext), size: info.size }
          }
        } catch (e) { /* try next candidate */ }
      }
      // 兜底：路径猜不到但运行时的文件一定在磁盘上（可能缺中间目录前缀）。
      // 在会话工作区里按文件名递归搜索，最多 4 层、每层 400 个目录、命中 5 个即止。
      if (cwd !== undefined && cwd !== '' && !t.startsWith('/')) {
        const base = cwd.replace(/\/+$/, '')
        const baseName = t.split(/[\\/]+/).pop()
        if (baseName !== undefined && baseName !== '' && /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|mp4|webm|mov|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(baseName)) {
          const found = await findFileByName(base, baseName, 0, 4)
          if (found !== undefined) {
            const lower = found.path.toLowerCase()
            const lastDot = lower.lastIndexOf('.')
            const ext = lastDot >= 0 ? lower.slice(lastDot) : ''
            return { path: normPath(found.path), name: found.path.split('/').pop(), ext, kind: mediaKind(ext), size: found.size }
          }
        }
      }
      return undefined
    }
    // 递归按文件名搜索：正式 host 用 node:fs，动态 host 用 fs 服务 listDir。
    async function findFileByName(dir, name, depth, maxDepth) {
      if (depth > maxDepth) return undefined
      let nodeFs
      try { nodeFs = require('node:fs') } catch (e) { nodeFs = undefined }
      if (nodeFs !== undefined) {
        return await findNode(dir, name, depth, maxDepth, nodeFs)
      }
      // 动态 host：用 fs 服务 listDir 递归
      const fsSvc = fsOf()
      if (fsSvc === undefined || typeof fsSvc.listDir !== 'function') return undefined
      try {
        const target = await fsSvc.resolve(dir)
        const entries = await fsSvc.listDir(target)
        let scanned = 0
        for (const e of entries) {
          if (e === null || typeof e !== 'object') continue
          if (e.type === 'file' && e.name === name) {
            const info = await fsSvc.stat(e.target)
            if (info !== undefined && info.type === 'file' && info.size > 0) {
              return { path: dir.replace(/\/+$/, '') + '/' + e.name, size: info.size }
            }
          }
          if (e.type === 'directory' && ++scanned <= 400) {
            const sub = await findFileByName(dir.replace(/\/+$/, '') + '/' + e.name, name, depth + 1, maxDepth)
            if (sub !== undefined) return sub
          }
        }
      } catch (e) { /* skip unreadable dirs */ }
      return undefined
    }
    async function findNode(dir, name, depth, maxDepth, nodeFs) {
      if (depth > maxDepth) return undefined
      let entries
      try { entries = nodeFs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return undefined }
      let scanned = 0
      for (const e of entries) {
        if (e.isFile() && e.name === name) {
          try {
            const st = nodeFs.statSync(dir + '/' + e.name)
            if (st.isFile() && st.size > 0) {
              return { path: normPath(dir + '/' + e.name), size: st.size }
            }
          } catch (err) { /* skip */ }
        }
        if (e.isDirectory() && ++scanned <= 400) {
          const sub = await findNode(dir + '/' + e.name, name, depth + 1, maxDepth, nodeFs)
          if (sub !== undefined) return sub
        }
      }
      return undefined
    }
    async function scanSessionMedia(sid) {
      let cwd = undefined
      // { turn, text } 列表，按事件顺序
      const texts = []
      try {
        const sq = ctx.get('sessionQuery')
        if (sq !== undefined && typeof sq.readSession === 'function') {
          const snap = await sq.readSession(sid)
          if (snap !== undefined && snap !== null) {
            if (snap.session !== undefined && snap.session !== null && typeof snap.session.cwd === 'string') cwd = snap.session.cwd
            if (Array.isArray(snap.events)) {
              let currentTurn = 0
              for (const ev of snap.events) {
                if (ev === null || typeof ev !== 'object') continue
                const d = ev.data
                if (d === null || typeof d !== 'object') continue
                if (ev.type === 'turn/start' && typeof d.turn === 'number') {
                  currentTurn = d.turn
                } else if (ev.type === 'user/message' && Array.isArray(d.content)) {
                  for (const b of d.content) {
                    if (b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') texts.push({ turn: currentTurn, text: b.text })
                  }
                } else if (ev.type === 'assistant/message' && d.message !== null && typeof d.message === 'object' && Array.isArray(d.message.content)) {
                  const t = typeof d.turn === 'number' ? d.turn : currentTurn
                  for (const b of d.message.content) {
                    if (b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') texts.push({ turn: t, text: b.text })
                  }
                }
              }
            }
          }
        }
      } catch (e) { /* sessionQuery may be unavailable */ }
      const seen = new Set()
      const items = []
      for (const entry of texts) {
        const found = extractMediaFromText(entry.text)
        for (const f of found) {
          const key = normPath(f.raw)
          if (seen.has(key)) continue
          seen.add(key)
          const resolved = await resolveWithCwd(cwd, f.raw)
          if (resolved === undefined) continue
          if (items.some((x) => x.path === resolved.path)) continue
          // 带轮次：同一文件可能在多轮被提到，只记首次出现的轮次
          items.push(Object.assign({ turn: entry.turn }, resolved))
        }
      }
      return items
    }
    function attachMediaRoutes() {
      const server = ctx.get('webServer')
      if (server === undefined || typeof server.register !== 'function') return
      // 列表接口：实时扫描 ?session=<id>
      const listDisposer = server.register({
        kind: 'exact',
        path: '/plugins/provider-quick-config/media-list',
        handler: async (req, res) => {
          const q = queryOf(req.url)
          const sid = q.session || ''
          if (sid === '') {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'missing session' }))
            return
          }
          try {
            const items = await scanSessionMedia(sid)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ items }))
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: String((e && e.message) || e) }))
          }
        },
      })
      // 文件接口：?p=<绝对路径>（扩展名白名单 + fs 校验，防任意读）
      const fileDisposer = server.register({
        kind: 'exact',
        path: '/plugins/provider-quick-config/media',
        handler: async (req, res) => {
          const q = queryOf(req.url)
          const p = q.p || ''
          const lower = p.toLowerCase()
          const lastDot = lower.lastIndexOf('.')
          const ext = lastDot >= 0 ? lower.slice(lastDot) : ''
          const mime = MEDIA_EXT[ext]
          if (mime === undefined || p === '') {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('unsupported')
            return
          }
          try {
            const fsSvc = fsOf()
            if (fsSvc === undefined) throw new Error('fs unavailable')
            const target = await fsSvc.resolve(p)
            const info = await fsSvc.stat(target)
            if (info === undefined || info.type !== 'file') throw new Error('not a file')
            const size = info.size
            const cap = 200 * 1024 * 1024
            if (size > cap) {
              res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('too-large')
              return
            }
            const baseHeaders = {
              'content-type': mime,
              'accept-ranges': 'bytes',
              'cache-control': 'private, max-age=60',
              'x-content-type-options': 'nosniff',
            }
            // Range 支持：浏览器 <video>/<audio> 播放需要 206 Partial Content
            const range = String(req.headers.range || '').match(/bytes=(\d*)-(\d*)/)
            if (range !== null) {
              const start = range[1] !== '' ? parseInt(range[1], 10) : 0
              const end = range[2] !== '' ? parseInt(range[2], 10) : size - 1
              if (!isFinite(start) || start < 0 || start >= size) {
                res.writeHead(416, Object.assign({}, baseHeaders, { 'content-range': 'bytes */' + size }))
                res.end()
                return
              }
              const chunkEnd = Math.min(end, size - 1)
              const length = chunkEnd - start + 1
              res.writeHead(206, Object.assign({}, baseHeaders, {
                'content-range': 'bytes ' + start + '-' + chunkEnd + '/' + size,
                'content-length': String(length),
              }))
              // 有 node:fs 就流式读分片；没有就整读后切
              let nodeFs
              try { nodeFs = require('node:fs') } catch (e) { nodeFs = undefined }
              if (nodeFs !== undefined) {
                const nodePath = require('node:path')
                const abs = nodePath.resolve(p)
                const stream = nodeFs.createReadStream(abs, { start, end: chunkEnd })
                stream.on('error', () => { res.destroy() })
                stream.pipe(res)
              } else {
                const bytes = await fsSvc.readBytes(target, undefined, cap)
                const slice = bytes.subarray(start, chunkEnd + 1)
                res.end(slice)
              }
              return
            }
            // 无 Range：整文件
            const bytes = await fsSvc.readBytes(target, undefined, cap)
            res.writeHead(200, Object.assign({}, baseHeaders, { 'content-length': String(size) }))
            res.end(bytes)
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
    ctx.effect(() => {
      return () => {
        try { if (disposeMediaRoutes !== undefined) disposeMediaRoutes() } catch (e) {}
      }
    })
    void probeAll()
    ctx.interval(() => { void syncAll() }, 60000)
    void syncAll()
  },
}
