<template>
  <div class="music-search">
    <van-notice-bar
      left-icon="info-o"
      text="多源免费曲库：Openverse / Jamendo / Freesound / Wikimedia / Archive / ccMixter / 电台。请遵守各曲目许可。"
    />

    <van-cell-group inset title="选择曲库">
      <div class="lib-tabs">
        <van-tag
          v-for="lib in LIBRARIES"
          :key="lib.id"
          :plain="library !== lib.id"
          :type="library === lib.id ? 'primary' : 'default'"
          size="medium"
          class="lib-tag"
          @click="onSelectLibrary(lib.id)"
        >
          {{ lib.name }}
        </van-tag>
      </div>
      <div class="lib-desc">{{ currentLibDesc }}</div>
    </van-cell-group>

    <van-cell-group inset title="搜索">
      <van-field
        v-model="keyword"
        label="关键词"
        placeholder="如 piano、jazz、ambient"
        clearable
        @keyup.enter="onSearch"
      >
        <template #button>
          <van-button size="small" type="primary" :loading="searching" @click="onSearch">
            搜索
          </van-button>
        </template>
      </van-field>
      <van-cell v-if="showLicenseFilter" title="许可筛选">
        <template #value>
          <van-radio-group v-model="licenseType" direction="horizontal" @change="onFilterChange">
            <van-radio name="">全部</van-radio>
            <van-radio name="commercial">可商用</van-radio>
            <van-radio name="modification">可修改</van-radio>
          </van-radio-group>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 结果列表：播放器展开在当前行 -->
    <van-cell-group v-if="tracks.length" inset :title="resultTitle">
      <div
        v-for="item in tracks"
        :key="item.id"
        class="track-row"
        :class="{ active: current?.id === item.id }"
      >
        <div class="track-main" @click="onRowClick(item)">
          <div class="cover" :style="coverStyle(item)">
            <van-icon v-if="!item.thumbnail" name="music-o" />
          </div>
          <div class="track-meta">
            <div class="track-title">{{ item.title }}</div>
            <div class="track-sub">{{ trackLabel(item) }}</div>
          </div>
          <van-tag plain :type="tagType(item)" class="lic-tag">{{ shortLicense(item) }}</van-tag>
          <van-icon
            :name="rowIcon(item)"
            class="play-icon"
            :class="{ spinning: current?.id === item.id && (playResolving || playLoading) }"
          />
        </div>

        <!-- 当前行内嵌播放器 -->
        <div v-if="current?.id === item.id" class="inline-player" @click.stop>
          <div class="player-row">
            <van-button
              type="primary"
              round
              size="small"
              :icon="isPlaying ? 'pause-circle-o' : 'play-circle-o'"
              :loading="playResolving || playLoading"
              @click="togglePlay"
            >
              {{ playButtonText }}
            </van-button>
            <span class="play-status">{{ playStatusText }}</span>
          </div>
          <audio
            ref="audioEl"
            :key="current.id + '-' + playAttempt"
            :src="playUrl"
            controls
            preload="auto"
            class="player"
            @loadstart="onLoadStart"
            @waiting="onWaiting"
            @canplay="onCanPlay"
            @playing="onPlaying"
            @pause="onPause"
            @error="onPlayError"
          ></audio>
          <div class="play-actions">
            <van-button
              v-if="current.downloadable !== false"
              type="primary"
              size="small"
              round
              icon="down"
              :loading="downloading"
              @click="onDownload(current)"
            >
              下载
            </van-button>
            <van-tag v-else type="warning" plain>直播流，不支持下载</van-tag>
            <van-button
              v-if="current.landingUrl"
              size="small"
              round
              icon="link-o"
              @click="openExternal(current.landingUrl)"
            >
              来源页
            </van-button>
          </div>
          <div v-if="current.attribution" class="attr">{{ current.attribution }}</div>
        </div>
      </div>
    </van-cell-group>

    <div v-if="tracks.length && page < pageCount" class="more-wrap">
      <van-button block round :loading="loadingMore" @click="onLoadMore">加载更多</van-button>
    </div>

    <van-empty v-if="searched && !tracks.length && !searching" description="没有找到相关音频" />
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import {
  LIBRARIES,
  searchMusic,
  proxiedUrl,
  resolveArchiveTrack,
  resolveRadioTrack,
  resolvePlayableUrl,
  isPlaylistUrl,
  mediaUrlCandidates
} from '../utils/musicLibraries'
import { downloadBlob, generateFilename, formatTime, formatSize } from '../utils/audio'

const keyword = ref('piano')
const library = ref('all')
const licenseType = ref('')
const searching = ref(false)
const loadingMore = ref(false)
const downloading = ref(false)
const searched = ref(false)
const tracks = ref([])
const resultCount = ref(0)
const page = ref(1)
const pageCount = ref(0)
const current = ref(null)
const audioEl = ref(null)
const playResolving = ref(false)
const playLoading = ref(false)
const isPlaying = ref(false)
const playAttempt = ref(0)
const retriedPlay = ref(false)
const playHint = ref('')

const playUrl = computed(() => (current.value?.audioUrl ? proxiedUrl(current.value.audioUrl) : ''))

const playButtonText = computed(() => {
  if (playResolving.value) return '解析中'
  if (playLoading.value) return '连接中'
  return isPlaying.value ? '暂停' : '播放'
})

const playStatusText = computed(() => {
  if (playHint.value) return playHint.value
  if (playResolving.value) return '正在解析地址…'
  if (playLoading.value) return '正在连接音源…'
  if (isPlaying.value) return current.value?.library === 'radio' ? '直播中' : '播放中'
  return '已暂停'
})

const currentLibDesc = computed(() => {
  const lib = LIBRARIES.find((l) => l.id === library.value)
  return lib ? lib.desc : ''
})

const showLicenseFilter = computed(() =>
  ['all', 'openverse', 'jamendo', 'freesound', 'wikimedia'].includes(library.value)
)

const resultTitle = computed(() => {
  const name = LIBRARIES.find((l) => l.id === library.value)?.name || ''
  return `搜索结果 · ${name}（约 ${resultCount.value}）`
})

const libraryLabel = (item) => {
  const lib = LIBRARIES.find((l) => l.id === item.library)
  return lib?.name || item.provider || item.library || ''
}

const shortLicense = (item) => {
  if (item.library === 'radio') return '直播'
  const lic = item.license || 'CC'
  return lic.length > 10 ? lic.slice(0, 10) + '…' : lic
}

const tagType = (item) => {
  if (item.library === 'radio') return 'warning'
  if (item.library === 'archive') return 'success'
  if (item.library === 'ccmixter') return 'primary'
  return 'primary'
}

const trackLabel = (item) => {
  const parts = [item.creator]
  if (item.duration) parts.push(formatTime(item.duration))
  if (item.filesize) parts.push(formatSize(item.filesize))
  parts.push(libraryLabel(item))
  return parts.join(' · ')
}

const coverStyle = (item) => {
  if (!item.thumbnail) return {}
  return {
    backgroundImage: `url(${proxiedUrl(item.thumbnail)})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  }
}

const rowIcon = (item) => {
  if (current.value?.id !== item.id) return 'play-circle-o'
  if (playResolving.value || playLoading.value) return 'replay'
  return isPlaying.value ? 'pause-circle-o' : 'play-circle-o'
}

const onSelectLibrary = (id) => {
  if (library.value === id) return
  library.value = id
  if (searched.value && keyword.value.trim()) onSearch()
}

const onSearch = async () => {
  const q = keyword.value.trim()
  if (!q) {
    showFailToast('请输入关键词')
    return
  }
  // 换搜索时停掉当前播放
  stopCurrent()
  searching.value = true
  searched.value = true
  page.value = 1
  tracks.value = []
  try {
    const data = await searchMusic(q, {
      library: library.value,
      page: 1,
      pageSize: 20,
      licenseType: licenseType.value || undefined
    })
    tracks.value = data.results
    resultCount.value = data.resultCount
    pageCount.value = data.pageCount
    page.value = data.page
    if (!data.results.length) showFailToast('没有结果')
  } catch (e) {
    showFailToast(e.message || '搜索失败')
  } finally {
    searching.value = false
  }
}

const onFilterChange = () => {
  if (searched.value && keyword.value.trim()) onSearch()
}

const onLoadMore = async () => {
  if (page.value >= pageCount.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const data = await searchMusic(keyword.value.trim(), {
      library: library.value,
      page: next,
      pageSize: 20,
      licenseType: licenseType.value || undefined
    })
    const exist = new Set(tracks.value.map((t) => t.id))
    tracks.value.push(...data.results.filter((t) => !exist.has(t.id)))
    page.value = data.page
    pageCount.value = data.pageCount
    resultCount.value = data.resultCount
  } catch (e) {
    showFailToast(e.message || '加载失败')
  } finally {
    loadingMore.value = false
  }
}

const patchTrack = (track) => {
  const idx = tracks.value.findIndex((t) => t.id === track.id)
  if (idx >= 0) tracks.value[idx] = track
}

/** v-for 内 ref 在 Vue3 可能是数组，统一取真实 audio 节点 */
const getAudioEl = () => {
  const el = audioEl.value
  if (Array.isArray(el)) return el.find(Boolean) || null
  return el || null
}

const stopCurrent = () => {
  try {
    getAudioEl()?.pause()
  } catch {}
  current.value = null
  isPlaying.value = false
  playLoading.value = false
  playResolving.value = false
  playHint.value = ''
}

/** 显式触发播放（绕过 autoplay 策略） */
const startPlayback = async () => {
  await nextTick()
  const el = getAudioEl()
  if (!el || !playUrl.value) return
  playLoading.value = true
  playHint.value = '正在连接音源…'
  try {
    el.load()
    await el.play()
    isPlaying.value = true
    playHint.value = ''
  } catch (e) {
    isPlaying.value = false
    if (e?.name === 'NotAllowedError') {
      playHint.value = '请再点一次「播放」'
      return
    }
    playHint.value = '连接失败'
    throw e
  } finally {
    playLoading.value = false
  }
}

const togglePlay = async () => {
  const el = getAudioEl()
  if (!el) return
  if (isPlaying.value) {
    el.pause()
    isPlaying.value = false
    playHint.value = ''
    return
  }
  try {
    await startPlayback()
  } catch {
    showFailToast('无法播放，请换一个音源试试')
  }
}

/** 点击行：同一行则暂停/继续，其它行则切到该行播放 */
const onRowClick = async (item) => {
  if (current.value?.id === item.id) {
    await togglePlay()
    return
  }
  await onPlay(item)
}

const onPlay = async (item) => {
  retriedPlay.value = false
  isPlaying.value = false
  playHint.value = ''
  playAttempt.value++

  let track = { ...item }
  if (!track.audioUrl && !(track.library === 'archive' || track.needsResolve)) {
    showFailToast('该曲目没有可播放地址')
    return
  }

  // 先展开当前行，再解析
  current.value = track.audioUrl ? track : { ...track, audioUrl: track.audioUrl || '' }
  playResolving.value = true
  playLoading.value = true

  try {
    if (item.library === 'radio' || String(item.id || '').startsWith('rb-')) {
      track = await resolveRadioTrack(item)
      patchTrack(track)
    } else if (item.needsResolve || (item.library === 'archive' && !item.audioUrl)) {
      track = await resolveArchiveTrack(item)
      patchTrack(track)
    } else if (item.audioUrl && isPlaylistUrl(item.audioUrl)) {
      const url = await resolvePlayableUrl(item.audioUrl)
      track = { ...item, audioUrl: url, needsResolve: false }
      patchTrack(track)
    }

    if (!track.audioUrl) {
      showFailToast('该曲目没有可播放地址')
      playResolving.value = false
      playLoading.value = false
      return
    }

    if (current.value?.audioUrl !== track.audioUrl) playAttempt.value++
    current.value = track
    playResolving.value = false
    await startPlayback()
  } catch (e) {
    playResolving.value = false
    playLoading.value = false
    if (e?.name === 'NotAllowedError') {
      playHint.value = '请点击「播放」按钮'
      return
    }
    if (!current.value?.audioUrl) {
      showFailToast(e.message || '无法解析该条目')
    }
  }
}

const onLoadStart = () => {
  playLoading.value = true
}

const onWaiting = () => {
  playLoading.value = true
  playHint.value = '缓冲中…'
}

const onCanPlay = () => {
  playLoading.value = false
  if (!isPlaying.value) playHint.value = '已就绪，点击播放'
}

const onPlaying = () => {
  retriedPlay.value = false
  playLoading.value = false
  isPlaying.value = true
  playHint.value = ''
}

const onPause = () => {
  isPlaying.value = false
}

const onPlayError = async () => {
  isPlaying.value = false
  playLoading.value = false
  const track = current.value
  if (!track?.audioUrl) {
    playHint.value = '播放失败'
    showFailToast('播放失败')
    return
  }

  if (!retriedPlay.value) {
    retriedPlay.value = true
    playResolving.value = true
    playHint.value = '换源重试中…'
    try {
      let next = track
      if (track.library === 'radio' || String(track.id || '').startsWith('rb-')) {
        next = await resolveRadioTrack(track)
      } else if (isPlaylistUrl(track.audioUrl)) {
        const url = await resolvePlayableUrl(track.audioUrl, { stationuuid: track.resolveId })
        next = { ...track, audioUrl: url }
      } else {
        const candidates = mediaUrlCandidates(track).filter((u) => u !== track.audioUrl)
        if (!candidates.length) throw new Error('retry-fail')
        next = {
          ...track,
          audioUrl: candidates[0],
          altUrls: candidates.slice(1)
        }
      }
      patchTrack(next)
      current.value = next
      playAttempt.value++
      playResolving.value = false
      await startPlayback()
      return
    } catch {
      playResolving.value = false
    }
  }

  playHint.value = '该音源暂时不可用'
  showFailToast(
    track.library === 'radio'
      ? '该电台暂时无法播放，请换一个试试'
      : '播放失败：源站拒绝访问（可点「来源页」）'
  )
}

const onDownload = async (item) => {
  if (!item.audioUrl || item.downloadable === false) return
  downloading.value = true
  try {
    const candidates = mediaUrlCandidates(item)
    let lastErr = null
    for (const url of candidates) {
      try {
        const res = await fetch(proxiedUrl(url))
        if (!res.ok) {
          lastErr = new Error(
            res.status === 403
              ? '源站防盗链拒绝（403），请点「来源页」下载'
              : `HTTP ${res.status}`
          )
          continue
        }
        const blob = await res.blob()
        const ext = (item.filetype || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3'
        const safeName = (item.title || 'track').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
        downloadBlob(blob, generateFilename(safeName, ext))
        showSuccessToast('下载成功')
        return
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr || new Error('未知错误')
  } catch (e) {
    showFailToast('下载失败：' + (e.message || '未知错误'))
  } finally {
    downloading.value = false
  }
}

const openExternal = (url) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<style lang="less" scoped>
.music-search {
  padding: 10px 0 80px;
}
.lib-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px 4px;
}
.lib-tag {
  cursor: pointer;
}
.lib-desc {
  padding: 0 16px 12px;
  font-size: 12px;
  color: #969799;
}
.track-row {
  border-bottom: 1px solid #ebedf0;
  background: #fff;
  &.active {
    background: #f0f7ff;
  }
  &:last-child {
    border-bottom: none;
  }
}
.track-main {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  gap: 4px;
}
.track-meta {
  flex: 1;
  min-width: 0;
}
.track-title {
  font-size: 14px;
  color: #323233;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-sub {
  margin-top: 2px;
  font-size: 12px;
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lic-tag {
  flex-shrink: 0;
  margin-left: 6px;
}
.cover {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: #ebedf0;
  margin-right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #969799;
  font-size: 20px;
  flex-shrink: 0;
}
.play-icon {
  font-size: 22px;
  color: #1989fa;
  margin-left: 8px;
  flex-shrink: 0;
  &.spinning {
    animation: spin 1s linear infinite;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.inline-player {
  padding: 0 16px 14px 70px;
}
.player-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.play-status {
  font-size: 12px;
  color: #969799;
}
.player {
  width: 100%;
}
.attr {
  margin-top: 8px;
  font-size: 11px;
  color: #969799;
  line-height: 1.4;
}
.play-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 8px;
}
.more-wrap {
  padding: 16px 16px 0;
}
:deep(.van-radio) {
  margin-right: 12px;
}
:deep(.van-radio__label) {
  font-size: 13px;
}
</style>
