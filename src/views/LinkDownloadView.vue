<template>
  <div class="link-download">
    <van-notice-bar left-icon="info-o" :text="noticeText" />

    <van-cell-group inset title="1. 粘贴公开媒体直链">
      <van-field
        v-model="link"
        label="链接"
        placeholder="https://example.com/audio.mp3"
        clearable
        rows="2"
        autosize
        type="textarea"
        @keyup.enter="onParse"
      >
        <template #button>
          <div class="field-btns">
            <van-button size="small" plain type="primary" @click="onPaste">粘贴</van-button>
            <van-button size="small" type="primary" :loading="parsing" @click="onParse">
              {{ parsing ? '解析中' : '解析播放' }}
            </van-button>
          </div>
        </template>
      </van-field>

      <van-cell title="媒体类型">
        <template #value>
          <van-radio-group v-model="forceType" direction="horizontal">
            <van-radio name="auto">自动</van-radio>
            <van-radio name="audio">音频</van-radio>
            <van-radio name="video">视频</van-radio>
          </van-radio-group>
        </template>
      </van-cell>

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
          <div class="player-box" :class="{ 'is-audio': mediaType === 'audio' }">
            <div v-if="loadError" class="video-error">
              <van-icon name="warning-o" size="36" color="#ff976a" />
              <div class="error-text">{{ loadError }}</div>
              <van-button size="small" type="primary" @click="retryLoad">重试加载</van-button>
            </div>
            <div v-else-if="mediaLoading" class="video-loading">
              <van-loading size="36px" color="#1989fa" />
              <div class="loading-text">加载中...</div>
            </div>

            <audio
              v-if="mediaType === 'audio'"
              :key="'a-' + mediaKey"
              ref="mediaEl"
              :src="displayUrl"
              controls
              preload="metadata"
              class="media-player audio-player"
              @loadedmetadata="onMediaReady"
              @canplay="onMediaCanPlay"
              @error="onMediaError"
            ></audio>
            <video
              v-else
              v-show="!loadError"
              :key="'v-' + mediaKey"
              ref="mediaEl"
              :src="displayUrl"
              controls
              playsinline
              preload="metadata"
              class="media-player"
              @loadedmetadata="onMediaReady"
              @canplay="onMediaCanPlay"
              @error="onMediaError"
            ></video>
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
      <van-cell title="原始地址" :label="mediaUrl" />
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
import { ref, computed, onMounted, nextTick } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { videoToAudio } from '../utils/ffmpeg'
import { downloadBlob, getFilenameFromUrl, generateFilename, formatTime, formatSize } from '../utils/audio'

const link = ref('')
const mediaUrl = ref('')
const mediaType = ref('video')
const forceType = ref('auto')
const mediaDuration = ref(0)
const mediaSize = ref(0)
const useProxy = ref(true)
const downloading = ref(false)
const extracting = ref(false)
const downloadPercent = ref(0)
const parsing = ref(false)
const mediaEl = ref(null)
const mediaKey = ref(0)
const mediaLoading = ref(false)
const loadError = ref('')
const history = ref([])

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v', 'ogv']
const AUDIO_EXTS = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma', 'oga']

const buildProxyUrl = (url) => `/proxy?url=${encodeURIComponent(url)}`

const EXTERNAL_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
]

const isDev = () => import.meta.env.DEV

const noticeText = computed(() =>
  useProxy.value
    ? '仅支持公开直链（.mp3/.m4a/.mp4 等）。平台分享页、会员试听链无法变成完整曲。'
    : '仅支持直链。若加载/下载失败请开启「使用跨域代理」。'
)

const displayUrl = computed(() => {
  if (!mediaUrl.value) return ''
  if (useProxy.value && isDev()) return buildProxyUrl(mediaUrl.value)
  if (useProxy.value) return EXTERNAL_PROXIES[0](mediaUrl.value)
  return mediaUrl.value
})

const detectType = (url) => {
  if (forceType.value === 'audio' || forceType.value === 'video') return forceType.value
  try {
    const u = new URL(url)
    const path = u.pathname.toLowerCase()
    const ext = (path.split('.').pop() || '').split(/[?#]/)[0]
    if (AUDIO_EXTS.includes(ext)) return 'audio'
    if (VIDEO_EXTS.includes(ext)) return 'video'
    // 无扩展名时：常见音频 CDN / 流式参数
    const hay = (path + u.search).toLowerCase()
    if (/(audio|sound|\.mp3|format=mp3|mime=audio)/i.test(hay)) return 'audio'
  } catch {}
  return 'video'
}

const extractUrlFromText = (text) => {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i)
  return m ? m[0].replace(/[),.;]+$/, '') : ''
}

const onPaste = async () => {
  try {
    const text = await navigator.clipboard.readText()
    const url = extractUrlFromText(text) || text.trim()
    if (!url) {
      showFailToast('剪贴板为空')
      return
    }
    link.value = url
    showSuccessToast('已粘贴')
  } catch {
    showFailToast('无法读取剪贴板，请手动粘贴')
  }
}

const onParse = async () => {
  parsing.value = true
  try {
    let url = extractUrlFromText(link.value) || link.value.trim()
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
    link.value = url
    mediaUrl.value = url
    mediaType.value = detectType(url)
    mediaDuration.value = 0
    mediaSize.value = 0
    loadError.value = ''
    mediaLoading.value = true
    mediaKey.value++
    addHistory(url)
    showSuccessToast(mediaType.value === 'audio' ? '已加载音频' : '已加载视频')
    await nextTick()
    probeFileInfo()
  } finally {
    parsing.value = false
  }
}

const probeFileInfo = async () => {
  try {
    const res = await fetchWithProxy(mediaUrl.value, { method: 'HEAD' })
    if (res.ok || res.status === 206) {
      mediaSize.value = parseInt(res.headers.get('content-length') || '0', 10)
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (forceType.value === 'auto') {
        if (ct.startsWith('audio/')) mediaType.value = 'audio'
        else if (ct.startsWith('video/')) mediaType.value = 'video'
      }
    }
  } catch {
    // HEAD 可能失败，忽略
  }
}

const onMediaReady = () => {
  mediaLoading.value = false
  loadError.value = ''
  if (mediaEl.value) {
    mediaDuration.value = mediaEl.value.duration || 0
  }
}

const onMediaCanPlay = () => {
  mediaLoading.value = false
}

const onMediaError = (e) => {
  mediaLoading.value = false
  const err = e.target?.error
  let msg = '媒体加载失败'
  if (err?.code === 1) msg = '加载被中止'
  else if (err?.code === 2) msg = '网络错误或跨域限制（建议开启代理）'
  else if (err?.code === 3) msg = '解码失败或格式不支持'
  else if (err?.code === 4) msg = '格式不受支持、链接失效，或不是公开直链'
  if (!useProxy.value) msg += '（可开启代理重试）'
  loadError.value = msg
}

const retryLoad = () => {
  loadError.value = ''
  mediaLoading.value = true
  mediaKey.value++
}

const fetchWithProxy = async (url, options = {}) => {
  const candidates = []
  if (useProxy.value && isDev()) candidates.push(buildProxyUrl(url))
  candidates.push(url)
  if (useProxy.value && !isDev()) {
    for (const proxyFn of EXTERNAL_PROXIES) candidates.push(proxyFn(url))
  }

  let lastError
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, options)
      if (res.ok || res.status === 206) return res
    } catch (e) {
      lastError = e
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
    const name = getFilenameFromUrl(mediaUrl.value)
    const fallbackExt = mediaType.value === 'audio' ? 'mp3' : 'mp4'
    downloadBlob(blob, name && name.includes('.') ? name : generateFilename('media', fallbackExt))
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
    try {
      const res = await fetchWithProxy(mediaUrl.value)
      blob = await res.blob()
    } catch {
      showFailToast('无法获取视频文件，请尝试开启代理')
      return
    }
    const fileName = getFilenameFromUrl(mediaUrl.value) || 'video.mp4'
    const file = new File([blob], fileName, { type: blob.type || 'video/mp4' })
    const audioBlob = await videoToAudio(file, 'mp3')
    downloadBlob(audioBlob, generateFilename('extracted', 'mp3'))
    showSuccessToast('音频提取成功')
  } catch (e) {
    showFailToast('提取失败：' + (e.message || '未知错误'))
  } finally {
    extracting.value = false
  }
}

const HISTORY_KEY = 'media-studio-history'

const loadHistory = () => {
  try {
    const data = localStorage.getItem(HISTORY_KEY)
    if (data) history.value = JSON.parse(data)
  } catch {}
}

const addHistory = (url) => {
  const exist = history.value.find((h) => h.url === url)
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
.field-btns {
  display: flex;
  gap: 6px;
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
  &.is-audio {
    min-height: 64px;
  }
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
:deep(.van-radio) {
  margin-right: 10px;
}
:deep(.van-radio__label) {
  font-size: 13px;
}
</style>
