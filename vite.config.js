import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'
import http from 'http'
import https from 'https'

// Vite配置：移动端优先 + 桌面端适配
export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [VantResolver({ importStyle: false })]
    }),
    // 自定义插件：把 /proxy?url=<encoded_url> 形式的请求代理到目标 URL
    // 这样浏览器的 fetch/video 标签都是同源请求，绕开 CORS 问题
    {
      name: 'url-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url || !req.url.startsWith('/proxy')) return next()

          let targetUrl = null

          // 格式1: /proxy?url=<encoded_url>
          const qMatch = req.url.match(/[?&]url=([^&]+)/)
          if (qMatch) {
            try { targetUrl = decodeURIComponent(qMatch[1]) } catch {}
          }

          // 格式2: /proxy/https%3A%2F%2Ftarget.com/video.mp4
          if (!targetUrl) {
            const m = req.url.match(/^\/proxy\/(.+)/)
            if (m) {
              try { targetUrl = decodeURIComponent(m[1]) } catch {}
            }
          }

          if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
            res.statusCode = 400
            res.end('Invalid proxy URL. Use: /proxy?url=<encoded_full_url>')
            return
          }

          console.log(`[proxy] ${req.method} ${targetUrl}`)

          const target = new URL(targetUrl)
          const httpModule = target.protocol === 'https:' ? https : http
          const options = {
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.pathname + target.search,
            method: req.method,
            headers: {
              ...req.headers,
              host: target.host
            }
          }
          delete options.headers['accept-encoding']
          delete options.headers['origin']
          delete options.headers['referer']

          const proxyReq = httpModule.request(options, (proxyRes) => {
            const skipHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-encoding', 'access-control-allow-origin', 'access-control-allow-credentials']
            for (const k in proxyRes.headers) {
              if (!skipHeaders.includes(k.toLowerCase())) {
                res.setHeader(k, proxyRes.headers[k])
              }
            }
            // 注入正确的 CORS 头（同源但 Vite 代理需要）
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.statusCode = proxyRes.statusCode
            proxyRes.pipe(res)
          })
          proxyReq.on('error', (e) => {
            if (!res.headersSent) {
              res.statusCode = 502
              res.end('Proxy error: ' + e.message)
            }
          })
          req.pipe(proxyReq)
        })
      }
    }
  ],
  server: {
    host: '0.0.0.0', // 允许手机端局域网访问
    port: 5174,
    // FFmpeg.wasm 需要的跨域隔离配置（启用 SharedArrayBuffer）
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
