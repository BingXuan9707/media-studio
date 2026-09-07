/**
 * 音频通用工具函数
 */

// 格式化时间 (秒 -> mm:ss)
export function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 格式化时间 (秒 -> mm:ss.mss，毫秒级，用于剪辑精确定位)
export function formatTimeMs(seconds) {
  if (seconds == null || isNaN(seconds)) return '00:00.000'
  const safe = Math.max(0, seconds)
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  const ms = Math.min(999, Math.round((safe - Math.floor(safe)) * 1000))
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

// 格式化文件大小
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + 'GB'
}

// 获取音频/视频时长（秒）
export function getMediaDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      resolve(audio.duration)
      URL.revokeObjectURL(url)
    }
    audio.onerror = () => {
      resolve(0)
      URL.revokeObjectURL(url)
    }
    audio.src = url
  })
}

// 根据链接提取文件名
export function getFilenameFromUrl(url) {
  try {
    const path = new URL(url).pathname
    return path.substring(path.lastIndexOf('/') + 1) || 'download'
  } catch {
    return 'download'
  }
}

// 生成时间戳文件名
export function generateFilename(prefix = 'output', ext = 'mp3') {
  const d = new Date()
  const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return `${prefix}_${ts}.${ext}`
}

// 下载 Blob
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
