import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

// FFmpeg.wasm 单例管理器
// 核心文件放在 src/assets/ffmpeg/ 下，用 Vite 的 new URL(path, import.meta.url) 语法引用
// 加载时用 toBlobURL() 转成 blob: URL，让 Emscripten 的 _locateFile 能正确定位 wasm
let ffmpeg = null
let loadingPromise = null

// Vite 官方静态资源引用语法：new URL('相对路径', import.meta.url).href
const CORE_SRC = new URL('../assets/ffmpeg/ffmpeg-core.js', import.meta.url).href
const WASM_SRC = new URL('../assets/ffmpeg/ffmpeg-core.wasm', import.meta.url).href

// 捕获 FFmpeg 最后一条日志用于错误诊断
let lastLog = ''

function extractError(e, context = '') {
  if (e === undefined || e === null) return context || '未知错误'
  if (typeof e === 'string') return e
  const msg = e.message || String(e) || '未知错误'
  const last = lastLog ? ` (FFmpeg日志: ${lastLog.slice(-120)})` : ''
  return context ? `${context}: ${msg}${last}` : `${msg}${last}`
}

/**
 * 加载并初始化 FFmpeg.wasm
 * @returns {Promise<FFmpeg>}
 */
export async function loadFFmpeg() {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg
  if (loadingPromise) return loadingPromise

  lastLog = ''
  ffmpeg = new FFmpeg()

  // 捕获日志（ffmpeg.on('progress', ...) 已经在各操作中单独注册）
  ffmpeg.on('log', ({ message }) => {
    lastLog = message
  })

  loadingPromise = (async () => {
    try {
      // toBlobURL 是 @ffmpeg/util 提供的：fetch → Blob → blob: URL
      // 这是 FFmpeg.wasm 官方推荐的加载方式，能确保 _locateFile 正确工作
      const coreURL = await toBlobURL(CORE_SRC, 'text/javascript')
      const wasmURL = await toBlobURL(WASM_SRC, 'application/wasm')
      await ffmpeg.load({ coreURL, wasmURL })
      return ffmpeg
    } catch (e) {
      ffmpeg = null
      loadingPromise = null
      throw new Error(extractError(e, 'FFmpeg 初始化失败'))
    }
  })()

  return loadingPromise
}

const SAFE_PROGRESS = (p) => typeof p === 'number' && p >= 0 && p <= 1 ? p : null

/**
 * 视频转音频
 */
export async function videoToAudio(file, format = 'mp3', onProgress) {
  const ff = await loadFFmpeg()
  const inputExt = (file.name?.split('.').pop() || 'mp4').toLowerCase()
  const inputName = 'input.' + inputExt
  const outputName = 'output.' + format

  try {
    ff.on('progress', ({ progress }) => { const p = SAFE_PROGRESS(progress); if (p !== null) onProgress && onProgress(p) })
    const data = await fetchFile(file)
    await ff.writeFile(inputName, data)

    await ff.exec(['-i', inputName, '-vn', '-acodec', getCodec(format), '-ab', '192k', outputName])
    const outData = await ff.readFile(outputName)

    return new Blob([outData.buffer], { type: getMimeType(format) })
  } catch (e) {
    throw new Error(extractError(e, '视频转音频'))
  } finally {
    // 无论成功失败都清理
    try { await ff.deleteFile(inputName) } catch {}
    try { await ff.deleteFile(outputName) } catch {}
  }
}

/**
 * 音频剪辑
 */
export async function cutAudio(file, start, end, format = 'mp3', onProgress) {
  const ff = await loadFFmpeg()
  const inputExt = (file.name?.split('.').pop() || 'mp3').toLowerCase()
  const inputName = 'input.' + inputExt
  const outputName = 'output.' + format

  try {
    ff.on('progress', ({ progress }) => { const p = SAFE_PROGRESS(progress); if (p !== null) onProgress && onProgress(p) })
    await ff.writeFile(inputName, await fetchFile(file))

    const duration = end - start
    await ff.exec([
      '-i', inputName,
      '-ss', String(start),
      '-t', String(duration),
      '-acodec', getCodec(format),
      outputName
    ])
    const data = await ff.readFile(outputName)
    return new Blob([data.buffer], { type: getMimeType(format) })
  } catch (e) {
    throw new Error(extractError(e, '音频剪辑'))
  } finally {
    try { await ff.deleteFile(inputName) } catch {}
    try { await ff.deleteFile(outputName) } catch {}
  }
}

/**
 * 合并多个音频文件
 */
export async function mergeAudios(files, format = 'mp3', onProgress) {
  const ff = await loadFFmpeg()
  ff.on('progress', ({ progress }) => { const p = SAFE_PROGRESS(progress); if (p !== null) onProgress && onProgress(p) })

  const inputFiles = []
  try {
    for (let i = 0; i < files.length; i++) {
      const ext = (files[i].name?.split('.').pop() || 'mp3').toLowerCase()
      const name = `input${i}.${ext}`
      await ff.writeFile(name, await fetchFile(files[i]))
      inputFiles.push(name)
    }

    const listContent = inputFiles.map(f => `file '${f}'`).join('\n')
    await ff.writeFile('list.txt', new TextEncoder().encode(listContent))

    const outputName = 'output.' + format
    await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-acodec', getCodec(format), outputName])
    const data = await ff.readFile(outputName)

    return new Blob([data.buffer], { type: getMimeType(format) })
  } catch (e) {
    throw new Error(extractError(e, '音频合并'))
  } finally {
    try { await ff.deleteFile('list.txt') } catch {}
    for (const f of inputFiles) {
      try { await ff.deleteFile(f) } catch {}
    }
    try { await ff.deleteFile('output.' + format) } catch {}
  }
}

/**
 * 音频高级处理
 */
export async function processAudio(file, options = {}, onProgress) {
  const ff = await loadFFmpeg()
  const inputExt = (file.name?.split('.').pop() || 'mp3').toLowerCase()
  const inputName = 'input.' + inputExt
  const format = options.format || 'mp3'
  const outputName = 'output.' + format

  try {
    ff.on('progress', ({ progress }) => { const p = SAFE_PROGRESS(progress); if (p !== null) onProgress && onProgress(p) })
    await ff.writeFile(inputName, await fetchFile(file))

    const filterArgs = []
    if (options.volume !== undefined && options.volume !== 1) {
      filterArgs.push(`volume=${options.volume}`)
    }
    if (options.speed !== undefined && options.speed !== 1) {
      filterArgs.push(`atempo=${options.speed}`)
    }
    if (options.fadeIn) {
      filterArgs.push(`afade=t=in:st=0:d=2`)
    }
    if (options.fadeOut) {
      filterArgs.push(`afade=t=out:st=0:d=2`)
    }

    const cmd = ['-i', inputName]
    if (filterArgs.length) cmd.push('-af', filterArgs.join(','))
    if (options.sampleRate) cmd.push('-ar', String(options.sampleRate))
    cmd.push('-acodec', getCodec(format), outputName)

    await ff.exec(cmd)
    const data = await ff.readFile(outputName)
    return new Blob([data.buffer], { type: getMimeType(format) })
  } catch (e) {
    throw new Error(extractError(e, '音频处理'))
  } finally {
    try { await ff.deleteFile(inputName) } catch {}
    try { await ff.deleteFile(outputName) } catch {}
  }
}

// 清理 FFmpeg 实例（用于页面卸载/重置）
export async function resetFFmpeg() {
  if (ffmpeg) {
    try { await ffmpeg.terminate() } catch {}
    ffmpeg = null
    loadingPromise = null
  }
}

function getCodec(format) {
  const codecs = {
    mp3: 'libmp3lame',
    wav: 'pcm_s16le',
    aac: 'aac',
    m4a: 'aac',
    ogg: 'libvorbis',
    flac: 'flac'
  }
  return codecs[format] || 'libmp3lame'
}

function getMimeType(format) {
  const types = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac'
  }
  return types[format] || 'audio/mpeg'
}

/**
 * 下载 Blob 数据为文件
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
