<template>
  <div class="link-download">
    <van-notice-bar
      left-icon="info-o"
      :text="noticeText"
    />

    <!-- 链接输入 -->
    <van-cell-group inset title="1. 输入媒体链接">
      <van-field
        v-model="link"
        label="链接"
        placeholder="https://example.com/video.mp4"
        clearable
        type="url"
        @keyup.enter="onParse"
      >
        <template #button>
          <van-button size="small" type="primary" :loading="parsing" @click="onParse">
            {{ parsing ? '解析中' : '解析播放' }}
          </van-button>
        </template>
      </van-field>

      <!-- CORS 代理开关：当直链跨域被拒时自动启用 -->
      <van-cell title="使用跨域代理" center>
        <template #label>
          <div class="proxy-desc">
            部分 CDN 跨域配置错误，需通过代理加载
            <van-icon name="shield-o" />
          </div>
        </template>
        <template #value>
          <van-switch v-model="useProxy" size="20px" />
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 播放器 -->
    <van-cell-group v-if="mediaUrl" inset title="2. 播放预览">
      <van-cell>
        <template #title>
          <div class="player-box">
            <div v-if="videoError" class="video-error">
              <van-icon name="warning-o" size="36" color="#ff976a" />
              <div class="error-text">{{ videoError }}</div>
              <van-button size="small" type="primary" @click="retryLoad">重试加载</van-button>
            </div>
            <div v-else-if="videoLoading" class="video-loading">
              <van-loading size="36px" color="#1989fa" />
              <div class="loading-text">视频加载中...</div>
            </div>
            <video
              v-show="!videoError"
              :key="videoKey"
              ref="videoEl"
              :src="displayUrl"
              controls
              playsinline
              preload="metadata"
              class="media-player"
              @loadedmetadata="onVideoReady"
              @canplay="onVideoCanPlay"
              @error="onVideoError"
            ></video>
            <audio
              v-if="mediaType === 'audio'"
              :src="displayUrl"
              controls
              preload="metadata"
              class="media-player audio-player"
              @loadedmetadata="onVideoReady"
              @error="onVideoError"
            ></audio>
          </div>
        </template>
      </van-cell>
      <van-cell title="文件类型">
        <template #value>
          <van-tag :type="mediaType === 'video' ? 'primary' : 'success'">
            {{ mediaType === 'video' ? '视频' : '音频' }}
          </van-tag>
        </template>
      </van-cell>
      <van-cell v-if="mediaDuration > 0" title="时长">
        <template #value>
          <span class="meta-text">{{ formatTime(mediaDuration) }}</span>
        </template>
      </van-cell>
      <van-cell v-if="mediaSize > 0" title="大小">
        <template #value>
          <span class="meta-text">{{ formatSize(mediaSize) }}</span>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 下载操作 -->
    <van-cell-group v-if="mediaUrl" inset title="3. 下载文件">
      <van-cell>
        <template #title>
          <div class="download-actions">
            <van-button
              type="primary"
              block
              round
              icon="down"
              :loading="downloading"
              :loading-text="'下载中 ' + downloadPercent + '%'"
              :disabled="downloading"
              @click="onDownload"
            >
              下载原文件
            </van-button>
            <van-button
              v-if="mediaType === 'video'"
              block
              round
              icon="music-o"
              :loading="extracting"
              loading-text="提取音频中..."
              :disabled="extracting"
              @click="onExtractAudio"
            >
              提取音频（MP3）
            </van-button>
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 历史记录 -->
    <van-cell-group v-if="history.length" inset title="历史记录">
      <van-cell
        v-for="(item, index) in history"
        :key="index"
        :title="item.name || item.url"
        :label="item.url"
        is-link
        @click="loadFromHistory(item)"
      >
        <template #right-icon>
          <van-icon name="cross" class="del-icon" @click.stop="removeHistory(index)" />
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { showFailToast, showSuccessToast, showLoadingToast, closeToast } from 'vant'
import { videoToAudio } from '../utils/ffmpeg'
import { downloadBlob, getFilenameFromUrl, generateFilename, formatTime, formatSize } from '../utils/audio'

const link = ref('')
const mediaUrl = ref('')
const mediaType = ref('video')
const mediaDuration = ref(0)
const mediaSize = ref(0)
const useProxy = ref(true) // 默认开启代理（开发环境下走 Vite 代理，稳定可靠）
const downloading = ref(false)
const extracting = ref(false)
const downloadPercent = ref(0)
const parsing = ref(false)
const videoEl = ref(null)
const videoKey = ref(0)
const videoLoading = ref(false)
const videoError = ref('')
const history = ref([])

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v', 'ogv']
const AUDIO_EXTS = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus']

// CORS 代理列表（按优先级尝试）
// 1. 优先用本地 Vite 开发服务器代理（同源，100% 绕过 CORS）
//    格式: /proxy?url=<encodeURIComponent(原始URL)>
// 2. 外部公共代理（可能被 CDN 反盗链拦截）
const buildProxyUrl = (url) => `/proxy?url=${encodeURIComponent(url)}`

const EXTERNAL_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
]

// 判断是否本地开发环境（Vite 代理可用）
const isDev = () => import.meta.env.DEV

const noticeText = computed(() =>
  useProxy.value
    ? '已启用跨域代理模式，部分链接可能速度较慢或不可用'
    : '仅支持直链（如 .mp4/.mp3 结尾）。若加载/下载失败请开启「使用跨域代理」。'
)

// 实际用于播放/fetch 的 URL
// 开发环境 + 开启代理 → 走 Vite 代理（同源，绕 CORS）
// 开发环境 + 关闭代理 → 直连（可能被 CORS 拦截）
// 生产环境 → 直连（需服务端 CORS 配合）或外部代理
const displayUrl = computed(() => {
  if (!mediaUrl.value) return ''
  if (useProxy.value && isDev()) {
    return buildProxyUrl(mediaUrl.value)
  }
  if (useProxy.value) {
    return EXTERNAL_PROXIES[0](mediaUrl.value)
  }
  return mediaUrl.value
})

const detectType = (url) => {
  const ext = (url.split('.').pop() || '').toLowerCase().split('?')[0]
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  return 'video'
}

const onParse = async () => {
  const url = link.value.trim()
  if (!url) {
    showFailToast('请输入链接')
    return
  }
  try {
    new URL(url)
  } catch {
    showFailToast('链接格式不正确')
    return
  }
  mediaUrl.value = url
  mediaType.value = detectType(url)
  mediaDuration.value = 0
  mediaSize.value = 0
  videoError.value = ''
  videoLoading.value = true
  videoKey.value++ // 强制重建 video 元素
  addHistory(url)
  showSuccessToast('已加载，请播放预览')
  await nextTick()
  // 提前探测文件大小
  probeFileInfo()
}

const probeFileInfo = async () => {
  try {
    const res = await fetch(mediaUrl.value, { method: 'HEAD' })
    if (res.ok) {
      mediaSize.value = parseInt(res.headers.get('content-length') || '0', 10)
    }
  } catch {
    // HEAD 请求可能因 CORS 失败，忽略
  }
}

const onVideoReady = () => {
  videoLoading.value = false
  videoError.value = ''
  if (videoEl.value) {
    mediaDuration.value = videoEl.value.duration || 0
  }
}

const onVideoCanPlay = () => {
  videoLoading.value = false
}

const onVideoError = (e) => {
  videoLoading.value = false
  const err = e.target?.error
  let msg = '视频加载失败'
  if (err?.code === 1) msg = '视频加载被中止'
  else if (err?.code === 2) msg = '网络错误或跨域限制（建议开启代理）'
  else if (err?.code === 3) msg = '视频解码失败或格式不支持'
  else if (err?.code === 4) msg = '视频格式不受支持或链接失效'
  if (!useProxy.value) msg += '（可开启代理重试）'
  videoError.value = msg
}

const retryLoad = () => {
  videoError.value = ''
  videoLoading.value = true
  videoKey.value++
}

// 带代理回退的 fetch：优先走同源代理，失败再试直连/外部代理
const fetchWithProxy = async (url, options = {}) => {
  // 构造候选 URL 列表（按优先级）
  const candidates = []
  if (useProxy.value && isDev()) {
    candidates.push(buildProxyUrl(url)) // 本地 Vite 代理（最稳）
  }
  candidates.push(url) // 直连（如果 CORS 正确配置）
  if (useProxy.value && !isDev()) {
    for (const proxyFn of EXTERNAL_PROXIES) {
      candidates.push(proxyFn(url))
    }
  }

  let lastError
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, options)
      if (res.ok || res.status === 206) return res
    } catch (e) {
      lastError = e
      continue
    }
  }
  throw lastError || new Error('所有获取方式均失败')
}

const onDownload = async () => {
  downloading.value = true
  downloadPercent.value = 0
  try {
    const res = await fetchWithProxy(mediaUrl.value)
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10)
    const reader = res.body.getReader()
    const chunks = []
    let received = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      if (contentLength > 0) {
        downloadPercent.value = Math.round((received / contentLength) * 100)
      }
    }

    const blob = new Blob(chunks)
    downloadBlob(blob, getFilenameFromUrl(mediaUrl.value) || generateFilename('media', 'bin'))
    showSuccessToast('下载成功')
  } catch (e) {
    showFailToast('下载失败：' + (e.message || '跨域或链接不可用'))
  } finally {
    downloading.value = false
    downloadPercent.value = 0
  }
}

const onExtractAudio = async () => {
  extracting.value = true
  try {
    let blob
    // 对于跨域视频，先下载为 blob 再传给 FFmpeg
    try {
      const res = await fetchWithProxy(mediaUrl.value)
      blob = await res.blob()
    } catch {
      showFailToast('无法获取视频文件，请尝试开启代理')
      return
    }
    const fileName = getFilenameFromUrl(mediaUrl.value) || 'video.mp4'
    const file = new File([blob], fileName, { type: blob.type || 'video/mp4' })
    const audioBlob = await videoToAudio(file, 'mp3', (p) => {
      // 复用 extracting 状态的 loading 文字
    })
    downloadBlob(audioBlob, generateFilename('extracted', 'mp3'))
    showSuccessToast('音频提取成功')
  } catch (e) {
    showFailToast('提取失败：' + (e.message || '未知错误'))
  } finally {
    extracting.value = false
  }
}

// 历史记录
const HISTORY_KEY = 'media-studio-history'

const loadHistory = () => {
  try {
    const data = localStorage.getItem(HISTORY_KEY)
    if (data) history.value = JSON.parse(data)
  } catch {}
}

const addHistory = (url) => {
  const exist = history.value.find(h => h.url === url)
  if (exist) return
  history.value.unshift({ url, name: getFilenameFromUrl(url) })
  if (history.value.length > 20) history.value.pop()
  saveHistory()
}

const removeHistory = (index) => {
  history.value.splice(index, 1)
  saveHistory()
}

const saveHistory = () => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  } catch {}
}

const loadFromHistory = (item) => {
  link.value = item.url
  onParse()
}

onMounted(loadHistory)
</script>

<style lang="less" scoped>
.link-download {
  padding: 10px 0 80px;
}
.proxy-desc {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #969799;
}
.player-box {
  width: 100%;
  position: relative;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.media-player {
  width: 100%;
  max-height: 240px;
  background: #000;
  border-radius: 8px;
}
.audio-player {
  background: transparent;
  max-height: none;
}
.video-loading,
.video-error {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #f7f8fa;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  z-index: 2;
}
.loading-text {
  color: #969799;
  font-size: 13px;
}
.error-text {
  color: #646566;
  font-size: 13px;
  text-align: center;
  padding: 0 20px;
  line-height: 1.5;
}
.meta-text {
  color: #323233;
  font-size: 14px;
}
.download-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.del-icon {
  color: #c8c9cc;
  margin-left: 8px;
  font-size: 16px;
}
</style>
