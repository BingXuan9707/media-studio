import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'
import http from 'http'
import https from 'https'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 跟随重定向抓取远程资源，再 pipe 回浏览器（同源，绕过 COEP/CORS）
 */
function proxyFetch(targetUrl, req, res, redirectsLeft = 5) {
  let target
  try {
    target = new URL(targetUrl)
  } catch {
    res.statusCode = 400
    res.end('Invalid URL')
    return
  }

  const httpModule = target.protocol === 'https:' ? https : http
  const origin = `${target.protocol}//${target.host}`
  // 防盗链站点需要带站点 Referer，否则常返回 403（ccMixter 等）
  const host = target.hostname
  let referer = `${origin}/`
  if (host === 'ccmixter.org' || host.endsWith('.ccmixter.org')) referer = 'https://ccmixter.org/'
  else if (host.includes('freesound.org')) referer = 'https://freesound.org/'
  else if (host.includes('jamendo.com')) referer = 'https://www.jamendo.com/'
  else if (host.includes('archive.org')) referer = 'https://archive.org/'
  else if (host.includes('wikimedia.org') || host.includes('wikipedia.org')) {
    referer = 'https://commons.wikimedia.org/'
  }

  const headers = {
    Host: target.host,
    'User-Agent': UA,
    Accept: req.headers.accept || '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Connection: 'keep-alive',
    Referer: referer,
    Origin: origin,
    // 电台 Icecast/SHOUTcast 对 Range 支持很差，浏览器默认带 Range 会导致无声/卡住
    'Icy-MetaData': '0'
  }
  // 仅对明显的静态文件透传 Range；直播流 / 无扩展名地址不带 Range
  const pathOnly = target.pathname.toLowerCase()
  const allowRange = /\.(mp3|m4a|aac|ogg|wav|flac|mp4|webm|mov)(\?|$)/i.test(pathOnly)
  if (allowRange && req.headers.range) headers.Range = req.headers.range
  if (allowRange && req.headers['if-range']) headers['If-Range'] = req.headers['if-range']

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    timeout: 20000
  }

  const proxyReq = httpModule.request(options, (proxyRes) => {
    const status = proxyRes.statusCode || 502
    const location = proxyRes.headers.location

    // 跟随 301/302/303/307/308
    if (location && status >= 300 && status < 400 && redirectsLeft > 0) {
      proxyRes.resume()
      let nextUrl
      try {
        nextUrl = new URL(location, target).href
      } catch {
        res.statusCode = 502
        res.end('Bad redirect')
        return
      }
      console.log(`[proxy] redirect ${status} -> ${nextUrl}`)
      proxyFetch(nextUrl, req, res, redirectsLeft - 1)
      return
    }

    const skip = new Set([
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade',
      'content-encoding',
      'access-control-allow-origin',
      'access-control-allow-credentials',
      'access-control-allow-headers',
      'access-control-allow-methods'
    ])

    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!skip.has(k.toLowerCase()) && v != null) {
        res.setHeader(k, v)
      }
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    // 直播流常无 content-length，禁止浏览器缓存半截
    if (!proxyRes.headers['content-length']) {
      res.setHeader('Cache-Control', 'no-store')
    }

    res.statusCode = status
    if (req.method === 'HEAD') {
      res.end()
      proxyRes.resume()
      return
    }
    proxyRes.pipe(res)
  })

  proxyReq.on('timeout', () => {
    proxyReq.destroy()
    if (!res.headersSent) {
      res.statusCode = 504
      res.end('Proxy timeout')
    }
  })
  proxyReq.on('error', (e) => {
    console.error('[proxy] error', e.message)
    if (!res.headersSent) {
      res.statusCode = 502
      res.end('Proxy error: ' + e.message)
    }
  })
  proxyReq.end()
}

// Vite配置：移动端优先 + 桌面端适配
export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [VantResolver({ importStyle: false })]
    }),
    {
      name: 'url-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url || !req.url.startsWith('/proxy')) return next()

          // CORS preflight
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', '*')
            res.statusCode = 204
            res.end()
            return
          }

          let targetUrl = null
          const qMatch = req.url.match(/[?&]url=([^&]+)/)
          if (qMatch) {
            try {
              targetUrl = decodeURIComponent(qMatch[1])
            } catch {}
          }
          if (!targetUrl) {
            const m = req.url.match(/^\/proxy\/(.+)/)
            if (m) {
              try {
                targetUrl = decodeURIComponent(m[1])
              } catch {}
            }
          }

          if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
            res.statusCode = 400
            res.end('Invalid proxy URL. Use: /proxy?url=<encoded_full_url>')
            return
          }

          console.log(`[proxy] ${req.method} ${targetUrl}`)
          proxyFetch(targetUrl, req, res)
        })
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  }
})
