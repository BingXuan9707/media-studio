/**
 * 多源免费合法曲库
 * - Openverse（聚合 Jamendo / Freesound / Wikimedia）
 * - Internet Archive（开源音频馆藏）
 * - ccMixter（CC 混音社区）
 * - Radio Browser（免费网络电台流）
 */

const isDev = () => import.meta.env.DEV

/** 开发环境走 Vite /proxy；生产尽量仍走同源代理（若部署了） */
export function proxiedUrl(url) {
  if (!url) return ''
  // COEP 下外链音视频必须同源，统一走 /proxy
  return `/proxy?url=${encodeURIComponent(url)}`
}

export function isPlaylistUrl(url) {
  if (!url) return false
  try {
    const path = new URL(url).pathname.toLowerCase()
    return /\.(m3u8?|pls)$/i.test(path)
  } catch {
    return /\.(m3u8?|pls)(\?|#|$)/i.test(url)
  }
}

function withTimeout(promise, ms, label = '超时') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** 从 m3u / pls 文本里抽出第一条可播地址 */
export function parsePlaylist(text, baseUrl = '') {
  if (!text) return ''
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  // PLS
  for (const line of lines) {
    const m = line.match(/^File\d+=(.+)$/i)
    if (m) {
      try {
        return new URL(m[1].trim(), baseUrl || undefined).href
      } catch {
        return m[1].trim()
      }
    }
  }

  // M3U / M3U8：跳过 # 注释，取第一条 http(s) 或相对路径
  for (const line of lines) {
    if (line.startsWith('#')) continue
    if (/^https?:\/\//i.test(line)) return line
    try {
      if (baseUrl) return new URL(line, baseUrl).href
    } catch {}
  }
  return ''
}

/**
 * 只读播放列表开头（带超时），避免卡在无限直播流上
 */
async function peekPlaylistText(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(proxiedUrl(url), {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/vnd.apple.mpegurl,audio/x-mpegurl,audio/mpegurl,text/plain,*/*',
        Range: 'bytes=0-4095'
      }
    })
    if (!res.ok && res.status !== 206) throw new Error(`无法打开流 (${res.status})`)
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (
      ct.startsWith('audio/') ||
      ct.startsWith('video/') ||
      ct.includes('octet-stream') ||
      ct.includes('icy')
    ) {
      const buf = await res.arrayBuffer()
      const text = new TextDecoder().decode(buf.slice(0, 512))
      if (/^#EXTM3U/i.test(text) || /^\[playlist\]/i.test(text)) return text
      return null
    }
    const text = await res.text()
    return text.slice(0, 8192)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析到浏览器 <audio> 能直接播的地址（处理播放列表、电台 click）
 */
export async function resolvePlayableUrl(url, opts = {}) {
  let current = (url || '').trim()
  if (!current) throw new Error('空地址')

  if (opts.stationuuid) {
    try {
      const data = await withTimeout(
        fetchJson(
          `https://de1.api.radio-browser.info/json/url/${encodeURIComponent(opts.stationuuid)}`
        ),
        5000,
        '电台源查询超时'
      )
      const next = data?.url_resolved || data?.url
      if (next) current = next
    } catch {
      // 用原地址继续
    }
  }

  // 只解开明确的播放列表，绝不对普通直播流做 peek（会卡住）
  for (let i = 0; i < 3; i++) {
    if (!isPlaylistUrl(current)) return current
    const text = await peekPlaylistText(current)
    if (text == null) return current
    const next = parsePlaylist(text, current)
    if (!next || next === current) {
      if (/^https?:\/\//i.test(current)) return current
      throw new Error('播放列表里没有可用地址')
    }
    current = next
  }

  return current
}

/** 电台条目播放前解析 */
export async function resolveRadioTrack(track) {
  const stationuuid = track.resolveId || String(track.id || '').replace(/^rb-/, '')
  const audioUrl = await resolvePlayableUrl(track.audioUrl, { stationuuid })
  return {
    ...track,
    audioUrl,
    needsResolve: false
  }
}

export const LIBRARIES = [
  { id: 'all', name: '全部', desc: '一次搜多个库' },
  { id: 'openverse', name: 'Openverse', desc: 'CC 聚合库' },
  { id: 'jamendo', name: 'Jamendo', desc: '独立音乐' },
  { id: 'freesound', name: 'Freesound', desc: '音效/采样' },
  { id: 'wikimedia', name: 'Wikimedia', desc: '维基共享' },
  { id: 'archive', name: 'Archive', desc: '互联网档案馆' },
  { id: 'ccmixter', name: 'ccMixter', desc: 'CC 混音' },
  { id: 'radio', name: '电台', desc: '免费直播流' }
]

const OPENVERSE_SOURCES = {
  jamendo: 'jamendo',
  freesound: 'freesound',
  wikimedia: 'wikimedia_audio'
}

function emptyResult(page = 1, pageSize = 20) {
  return { resultCount: 0, pageCount: 0, page, pageSize, results: [] }
}

function makeTrack(partial) {
  return {
    id: partial.id,
    title: partial.title || '未命名',
    creator: partial.creator || '未知作者',
    creatorUrl: partial.creatorUrl || '',
    audioUrl: partial.audioUrl || '',
    landingUrl: partial.landingUrl || '',
    thumbnail: partial.thumbnail || '',
    license: partial.license || '',
    licenseUrl: partial.licenseUrl || '',
    attribution: partial.attribution || '',
    provider: partial.provider || '',
    library: partial.library || '',
    filetype: partial.filetype || 'mp3',
    filesize: partial.filesize || 0,
    duration: partial.duration || 0,
    tags: partial.tags || [],
    downloadable: partial.downloadable !== false,
    needsResolve: !!partial.needsResolve,
    resolveId: partial.resolveId || '',
    altUrls: Array.isArray(partial.altUrls) ? partial.altUrls.filter(Boolean) : []
  }
}

/** 播放/下载时的候选地址（含备用） */
export function mediaUrlCandidates(track) {
  if (!track) return []
  const list = [track.audioUrl, ...(track.altUrls || [])]
  return [...new Set(list.filter(Boolean))]
}

async function fetchJson(url) {
  const res = await fetch(proxiedUrl(url))
  if (!res.ok) throw new Error(`请求失败 (${res.status})`)
  return res.json()
}

/** Openverse / 分源 */
async function searchOpenverse(query, opts = {}) {
  const page = opts.page || 1
  const pageSize = Math.min(opts.pageSize || 20, 50)
  const params = new URLSearchParams({
    q: query.trim(),
    page: String(page),
    page_size: String(pageSize)
  })
  if (opts.licenseType) params.set('license_type', opts.licenseType)
  if (opts.source) params.set('source', opts.source)

  const data = await fetchJson(`https://api.openverse.org/v1/audio/?${params}`)
  const libraryLabel = opts.source
    ? Object.keys(OPENVERSE_SOURCES).find((k) => OPENVERSE_SOURCES[k] === opts.source) || 'openverse'
    : 'openverse'

  return {
    resultCount: data.result_count || 0,
    pageCount: data.page_count || 0,
    page: data.page || page,
    pageSize: data.page_size || pageSize,
    results: (data.results || []).map((item) => {
      const durationMs = item.duration || 0
      const durationSec = durationMs > 1000 ? durationMs / 1000 : durationMs
      return makeTrack({
        id: `ov-${item.id}`,
        title: item.title,
        creator: item.creator,
        creatorUrl: item.creator_url,
        audioUrl: item.url,
        landingUrl: item.foreign_landing_url,
        thumbnail: item.thumbnail,
        license: item.license,
        licenseUrl: item.license_url,
        attribution: item.attribution,
        provider: item.provider || item.source,
        library: libraryLabel,
        filetype: item.filetype || 'mp3',
        filesize: item.filesize || 0,
        duration: durationSec,
        tags: (item.tags || []).map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean)
      })
    })
  }
}

/** Internet Archive：开源音频 + netlabels */
async function searchArchive(query, opts = {}) {
  const page = opts.page || 1
  const pageSize = Math.min(opts.pageSize || 12, 30)
  const q = [
    'mediatype:audio',
    '(collection:opensource_audio OR collection:netlabels OR collection:audio_music)',
    `(title:(${query}) OR creator:(${query}) OR description:(${query}))`
  ].join(' AND ')

  const params = new URLSearchParams({
    q,
    rows: String(pageSize),
    page: String(page),
    output: 'json'
  })
  ;['identifier', 'title', 'creator', 'year', 'licenseurl'].forEach((f) => {
    params.append('fl[]', f)
  })

  const data = await fetchJson(`https://archive.org/advancedsearch.php?${params}`)
  const docs = data.response?.docs || []
  const numFound = data.response?.numFound || 0

  // 并行解析前若干条的可播放 MP3
  const resolved = await Promise.all(
    docs.map(async (doc) => {
      const id = doc.identifier
      let audioUrl = ''
      let filesize = 0
      let filetype = 'mp3'
      try {
        const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(id)}`)
        const files = meta.files || []
        const mp3 =
          files.find((f) => /vbr mp3/i.test(f.format || '')) ||
          files.find((f) => /^mp3$/i.test(f.format || '')) ||
          files.find((f) => /\.mp3$/i.test(f.name || ''))
        if (mp3?.name) {
          audioUrl = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(mp3.name)}`
          filesize = parseInt(mp3.size || '0', 10) || 0
          filetype = 'mp3'
        }
      } catch {
        // 保留条目，点击时再试
      }
      const creator = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator
      const licenseUrl = Array.isArray(doc.licenseurl) ? doc.licenseurl[0] : doc.licenseurl
      return makeTrack({
        id: `ia-${id}`,
        title: doc.title || id,
        creator: creator || 'Internet Archive',
        audioUrl,
        landingUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
        license: licenseUrl ? '见来源页' : 'Archive',
        licenseUrl: licenseUrl || '',
        attribution: `"${doc.title || id}" via Internet Archive`,
        provider: 'Internet Archive',
        library: 'archive',
        filetype,
        filesize,
        needsResolve: !audioUrl,
        resolveId: id
      })
    })
  )

  return {
    resultCount: numFound,
    pageCount: Math.ceil(numFound / pageSize) || 0,
    page,
    pageSize,
    results: resolved.filter((t) => t.audioUrl || t.needsResolve)
  }
}

/** 点击时补全 Archive 播放地址 */
export async function resolveArchiveTrack(track) {
  if (track.audioUrl) return track
  const id = track.resolveId
  if (!id) return track
  const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(id)}`)
  const files = meta.files || []
  const mp3 =
    files.find((f) => /vbr mp3/i.test(f.format || '')) ||
    files.find((f) => /^mp3$/i.test(f.format || '')) ||
    files.find((f) => /\.mp3$/i.test(f.name || ''))
  if (!mp3?.name) throw new Error('未找到可播放的 MP3')
  return {
    ...track,
    audioUrl: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(mp3.name)}`,
    filesize: parseInt(mp3.size || '0', 10) || 0,
    needsResolve: false
  }
}

/** ccMixter */
async function searchCcMixter(query, opts = {}) {
  const page = opts.page || 1
  const pageSize = Math.min(opts.pageSize || 20, 40)
  const offset = (page - 1) * pageSize
  const params = new URLSearchParams({
    f: 'json',
    t: 'info',
    limit: String(pageSize),
    offset: String(offset),
    search_type: 'any',
    search: query.trim(),
    sort: 'rank'
  })

  const list = await fetchJson(`https://ccmixter.org/api/query?${params}`)
  const items = Array.isArray(list) ? list : []

  const results = items
    .map((item) => {
      const file =
        (item.files || []).find((f) => /mp3/i.test(f.file_nicname || f.file_name || '')) ||
        (item.files || [])[0]
      if (!file?.download_url && !file?.file_name) return null
      const ps = file.file_format_info?.ps || ''
      let duration = 0
      const m = String(ps).match(/(\d+):(\d+)/)
      if (m) duration = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
      // 统一 https，并准备备用直链（防盗链 / 路径变更时换源）
      const primary = String(file.download_url || '')
        .replace(/^http:\/\//i, 'https://')
        .trim()
      const user = item.user_name || ''
      const fname = file.file_name || ''
      const alt =
        user && fname
          ? `https://ccmixter.org/content/${encodeURIComponent(user)}/${encodeURIComponent(fname)}`
          : ''
      const audioUrl = primary || alt
      if (!audioUrl) return null
      return makeTrack({
        id: `ccm-${item.upload_id}`,
        title: item.upload_name,
        creator: item.user_real_name || item.user_name,
        creatorUrl: item.artist_page_url,
        audioUrl,
        landingUrl: item.file_page_url,
        license: item.license_name || 'CC',
        licenseUrl: item.license_url || '',
        attribution: `"${item.upload_name}" by ${item.user_real_name || item.user_name} via ccMixter`,
        provider: 'ccMixter',
        library: 'ccmixter',
        filetype: 'mp3',
        filesize: file.file_rawsize || 0,
        duration,
        tags: String(item.upload_tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8),
        // 挂在对象上供换源重试（makeTrack 未声明的字段也会保留在展开场景，这里显式带回）
        altUrls: [alt, primary].filter((u) => u && u !== audioUrl)
      })
    })
    .filter(Boolean)

  // API 不返回总数，有满页则认为可能还有下一页
  const maybeMore = results.length >= pageSize
  return {
    resultCount: maybeMore ? page * pageSize + 1 : (page - 1) * pageSize + results.length,
    pageCount: maybeMore ? page + 1 : page,
    page,
    pageSize,
    results
  }
}

/** Radio Browser 免费电台（优先 MP3/AAC，跳过纯 HLS 以便原生 audio 可播） */
async function searchRadio(query, opts = {}) {
  const page = opts.page || 1
  const pageSize = Math.min(opts.pageSize || 20, 50)
  const offset = (page - 1) * pageSize
  const params = new URLSearchParams({
    name: query.trim(),
    limit: String(pageSize * 2), // 多取一些再过滤
    offset: String(offset),
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true'
  })

  const list = await fetchJson(`https://de1.api.radio-browser.info/json/stations/search?${params}`)
  const items = Array.isArray(list) ? list : []

  const results = items
    .map((s) => {
      const stream = s.url_resolved || s.url
      if (!stream) return null
      const codec = String(s.codec || '').toUpperCase()
      // 浏览器原生 <audio> 基本不支持纯 HLS
      if (Number(s.hls) === 1 && !/MP3|AAC|OGG|VORBIS|OPUS/i.test(codec)) return null
      if (/\.m3u8(\?|$)/i.test(stream) && !/MP3|AAC/i.test(codec)) return null
      return makeTrack({
        id: `rb-${s.stationuuid}`,
        title: s.name,
        creator: s.country || 'Radio',
        audioUrl: stream,
        landingUrl: s.homepage || '',
        thumbnail: s.favicon || '',
        license: '电台直播',
        attribution: `${s.name} · Radio Browser`,
        provider: 'Radio Browser',
        library: 'radio',
        filetype: (s.codec || 'mp3').toLowerCase() || 'mp3',
        tags: String(s.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 6),
        downloadable: false,
        needsResolve: true,
        resolveId: s.stationuuid
      })
    })
    .filter(Boolean)
    .slice(0, pageSize)

  const maybeMore = results.length >= pageSize
  return {
    resultCount: maybeMore ? page * pageSize + 1 : (page - 1) * pageSize + results.length,
    pageCount: maybeMore ? page + 1 : page,
    page,
    pageSize,
    results
  }
}

/**
 * 统一搜索入口
 * @param {string} query
 * @param {{ library?: string, page?: number, pageSize?: number, licenseType?: string }} opts
 */
export async function searchMusic(query, opts = {}) {
  const library = opts.library || 'all'
  const page = opts.page || 1
  const pageSize = opts.pageSize || 20
  const licenseType = opts.licenseType || ''
  const q = query.trim()
  if (!q) return emptyResult(page, pageSize)

  if (library === 'openverse') {
    return searchOpenverse(q, { page, pageSize, licenseType: licenseType || undefined })
  }
  if (OPENVERSE_SOURCES[library]) {
    return searchOpenverse(q, {
      page,
      pageSize,
      licenseType: licenseType || undefined,
      source: OPENVERSE_SOURCES[library]
    })
  }
  if (library === 'archive') return searchArchive(q, { page, pageSize })
  if (library === 'ccmixter') return searchCcMixter(q, { page, pageSize })
  if (library === 'radio') return searchRadio(q, { page, pageSize })

  // 全部：并行搜多个库（首页各取一部分）
  const per = Math.max(6, Math.floor(pageSize / 3))
  const tasks = [
    searchOpenverse(q, { page, pageSize: per, licenseType: licenseType || undefined }).catch(() => emptyResult()),
    searchArchive(q, { page, pageSize: Math.min(8, per) }).catch(() => emptyResult()),
    searchCcMixter(q, { page, pageSize: per }).catch(() => emptyResult())
  ]
  // 第 1 页顺带带一点电台
  if (page === 1) {
    tasks.push(searchRadio(q, { page: 1, pageSize: 4 }).catch(() => emptyResult()))
  }

  const parts = await Promise.all(tasks)
  const results = []
  const seen = new Set()
  for (const part of parts) {
    for (const t of part.results) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      results.push(t)
    }
  }

  const resultCount = parts.reduce((s, p) => s + (p.resultCount || 0), 0)
  const pageCount = Math.max(1, ...parts.map((p) => p.pageCount || 1))

  return {
    resultCount,
    pageCount,
    page,
    pageSize,
    results
  }
}

// 兼容旧引用
export async function searchAudio(query, opts = {}) {
  return searchMusic(query, { ...opts, library: opts.library || 'openverse' })
}
