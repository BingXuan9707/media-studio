<template>
  <div class="audio-cut">
    <!-- 上传区域 -->
    <van-cell-group inset title="1. 选择音频文件">
      <van-cell>
        <template #title>
          <div
            ref="uploadBoxRef"
            class="upload-box-wrapper"
            @dragenter.prevent
            @dragover.prevent
            @dragleave.prevent="onLocalDragLeave"
            @drop.prevent="onLocalDrop"
          >
            <van-uploader
              v-model="fileList"
              :max-count="1"
              :after-read="onFileSelected"
              accept="audio/*"
              result-type="file"
            >
              <div class="upload-box" :class="{ 'is-dragging': localDragging }">
                <van-icon name="music-o" size="40" />
                <div class="upload-text">点击选择 或 拖拽音频文件到这里</div>
                <div class="upload-hint">支持 MP3/WAV/AAC/M4A 等</div>
              </div>
            </van-uploader>
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 波形 + 剪辑控制 -->
    <van-cell-group v-if="selectedFile" inset title="2. 选择剪辑区间">
      <!-- 波形 + 时间标尺 -->
      <van-cell>
        <template #title>
          <div class="waveform-box" @touchstart="onPinchStart" @touchmove="onPinchMove" @touchend="onPinchEnd" @touchcancel="onPinchEnd">
            <div ref="waveformEl" class="waveform"></div>
            <div v-if="!wavesurferReady" class="waveform-loading">
              <van-loading size="24px">波形解码中...</van-loading>
            </div>
            <div v-if="wavesurferReady" class="zoom-bar">
              <div class="ctrl-btn zoom-btn" :class="{ disabled: zoomIndex === 0 }" @click="applyZoom(zoomIndex - 1)">
                <van-icon name="minus" size="20" />
              </div>
              <div class="zoom-label" @click="applyZoom(0)">{{ zoomLabel }}</div>
              <div class="ctrl-btn zoom-btn" :class="{ disabled: zoomIndex === ZOOM_LEVELS.length - 1 }" @click="applyZoom(zoomIndex + 1)">
                <van-icon name="plus" size="20" />
              </div>
            </div>
          </div>
          <div class="drag-hint">
            <van-icon name="info-o" /> 拖动蓝色边界调整选区、拖中间整体移动；双指捏合或 ± 按钮缩放波形；时间支持直接输入（如 00:01.500 或 1.5）
          </div>
        </template>
      </van-cell>

      <!-- 播放控制条 -->
      <van-cell>
        <template #title>
          <div class="player-bar">
            <div class="ctrl-btn" @click="nudgeTime(-1)" title="后退 1 秒">
              <span class="nudge-label">-1s</span>
            </div>
            <div class="ctrl-btn" @click="nudgeTime(-0.1)" title="后退 0.1 秒">
              <van-icon name="arrow-left" size="20" color="#1989fa" />
            </div>
            <div class="ctrl-btn play-btn" @click="togglePlay">
              <van-icon :name="isPlaying ? 'pause-circle-o' : 'play-circle-o'" size="44" :color="isPlaying ? '#ee0a24' : '#1989fa'" />
            </div>
            <div class="ctrl-btn" @click="nudgeTime(0.1)" title="前进 0.1 秒">
              <van-icon name="arrow-right" size="20" color="#1989fa" />
            </div>
            <div class="ctrl-btn" @click="nudgeTime(1)" title="前进 1 秒">
              <span class="nudge-label">+1s</span>
            </div>
          </div>
          <div class="player-sub">
            <div class="time-display">
              <span class="cur-time">{{ formatTimeMs(currentTime) }}</span>
              <span class="sep">/</span>
              <span class="dur-time">{{ formatTimeMs(duration) }}</span>
            </div>
            <div class="ctrl-btn" @click="stopPlay" title="回到选区起点并暂停">
              <van-icon name="stop-circle-o" size="26" color="#969799" />
            </div>
            <div class="ctrl-btn" @click="seekToStart" title="跳到选区起点">
              <van-icon name="aim" size="26" color="#1989fa" />
            </div>
            <div :class="['ctrl-btn', 'loop-btn', { active: loopRegion }]" @click="loopRegion = !loopRegion" title="循环播放选区">
              <van-icon name="replay" size="26" />
            </div>
          </div>
        </template>
      </van-cell>

      <!-- 选区时间信息 + 滑块精细调整 -->
      <van-cell title="开始时间" center>
        <template #value>
          <van-field
            v-model="startTimeText"
            class="time-field"
            placeholder="00:01.500 或 1.5"
            input-align="center"
            @focus="onStartFocus"
            @blur="onStartBlur"
          />
        </template>
      </van-cell>
      <van-cell>
        <template #title>
          <van-slider v-model="startTime" :min="0" :max="duration" :step="0.001" @update:model-value="onStartTimeInput" />
        </template>
      </van-cell>
      <van-cell title="结束时间" center>
        <template #value>
          <van-field
            v-model="endTimeText"
            class="time-field"
            placeholder="00:10.000 或 120"
            input-align="center"
            @focus="onEndFocus"
            @blur="onEndBlur"
          />
        </template>
      </van-cell>
      <van-cell>
        <template #title>
          <van-slider v-model="endTime" :min="0" :max="duration" :step="0.001" @update:model-value="onEndTimeInput" />
        </template>
      </van-cell>
      <van-cell title="剪辑时长">
        <template #value>
          <van-tag type="primary">{{ formatTimeMs(Math.max(0, endTime - startTime)) }}</van-tag>
        </template>
      </van-cell>
      <van-cell>
        <template #title>
          <div class="region-actions">
            <van-button size="small" plain icon="replay" @click="resetRegion">重置选区</van-button>
            <van-button size="small" plain icon="play-circle-o" @click="playRegion">试听选区</van-button>
            <van-button size="small" plain @click="setRegionFromCurrent">设当前为起点</van-button>
            <van-button size="small" plain @click="setRegionEndFromCurrent">设当前为终点</van-button>
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 高级处理选项 -->
    <van-cell-group v-if="selectedFile" inset title="3. 高级处理（可选）">
      <van-cell title="输出格式">
        <template #value>
          <van-dropdown-menu>
            <van-dropdown-item v-model="format" :options="formatOptions" />
          </van-dropdown-menu>
        </template>
      </van-cell>
      <van-cell title="音量调整">
        <template #value>
          {{ processOptions.volume.toFixed(1) }}x
        </template>
      </van-cell>
      <van-cell>
        <template #title>
          <van-slider v-model="processOptions.volume" :min="0.5" :max="3" :step="0.1" />
        </template>
      </van-cell>
      <van-cell title="播放速度">
        <template #value>
          {{ processOptions.speed.toFixed(2) }}x
        </template>
      </van-cell>
      <van-cell>
        <template #title>
          <van-slider v-model="processOptions.speed" :min="0.5" :max="2" :step="0.05" />
        </template>
      </van-cell>
      <van-cell title="淡入效果" center>
        <template #value>
          <van-switch v-model="processOptions.fadeIn" />
        </template>
      </van-cell>
      <van-cell title="淡出效果" center>
        <template #value>
          <van-switch v-model="processOptions.fadeOut" />
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 操作按钮（吸底，手机端随时可点） -->
    <div class="action-area">
      <van-button
        type="primary"
        block
        round
        size="large"
        :disabled="!selectedFile || processing"
        :loading="processing"
        loading-text="处理中..."
        @click="onProcess"
      >
        开始剪辑处理
      </van-button>
    </div>

    <!-- 结果 -->
    <van-cell-group v-if="processing || resultBlob" inset title="4. 处理结果">
      <van-cell>
        <template #title>
          <div v-if="processing" class="progress-box">
            <van-progress :percentage="progressPercent" />
            <div class="progress-hint">FFmpeg 正在处理音频...</div>
          </div>
          <div v-else-if="resultBlob" class="result-box">
            <audio :src="resultUrl" controls style="width:100%"></audio>
            <div class="result-actions">
              <van-button type="primary" size="small" icon="down" @click="downloadResult">下载</van-button>
              <van-button size="small" @click="reset">重新处理</van-button>
            </div>
          </div>
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onUnmounted, nextTick } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import { cutAudio, processAudio } from '../utils/ffmpeg'
import { formatTime, formatTimeMs, formatSize, downloadBlob, generateFilename } from '../utils/audio'
import { useFileStore } from '../store/file'

const fileStore = useFileStore()

const fileList = ref([])
const selectedFile = ref(null)
const waveformEl = ref(null)
let wavesurfer = null
let regionsPlugin = null
let region = null
let currentObjectUrl = ''
// 同步锁：避免 Slider ↔ Region 双向同步产生循环
let isSyncing = false

const wavesurferReady = ref(false)
const isPlaying = ref(false)
const currentTime = ref(0)
const loopRegion = ref(false)
const duration = ref(0)
const startTime = ref(0)
const endTime = ref(0)

// 波形缩放：0 = 适应全部，越大每秒像素越多（可精确定位到毫秒）
const ZOOM_LEVELS = [0, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]
const zoomIndex = ref(0)
const zoomLabel = computed(() => zoomIndex.value === 0 ? '全景' : `${ZOOM_LEVELS[zoomIndex.value]} px/s`)

// 起止点边界：保证 start < end（最小间隔 1ms）
const startMax = computed(() => Math.max(0, endTime.value - 0.001))
const endMin = computed(() => Math.min(duration.value, startTime.value + 0.001))

// 时间输入框文本（可直接键入 mm:ss.mss 或秒数，失焦生效）
const startTimeText = ref('')
const endTimeText = ref('')
const startFocused = ref(false)
const endFocused = ref(false)
watch(startTime, (v) => { if (!startFocused.value) startTimeText.value = formatTimeMs(v) })
watch(endTime, (v) => { if (!endFocused.value) endTimeText.value = formatTimeMs(v) })

const format = ref('mp3')
const formatOptions = [
  { text: 'MP3 格式', value: 'mp3' },
  { text: 'WAV 格式', value: 'wav' },
  { text: 'AAC 格式', value: 'aac' },
  { text: 'M4A 格式', value: 'm4a' },
  { text: 'OGG 格式', value: 'ogg' },
  { text: 'FLAC 格式', value: 'flac' }
]

const processOptions = reactive({
  volume: 1.0,
  speed: 1.0,
  fadeIn: false,
  fadeOut: false
})

const processing = ref(false)
const progressValue = ref(0)
const resultBlob = ref(null)
const resultUrl = ref('')

const progressPercent = computed(() => Math.round(progressValue.value * 100))

const onFileSelected = async (fileItem) => {
  selectedFile.value = fileItem.file
  fileList.value = [{ file: fileItem.file }]
  resultBlob.value = null
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  wavesurferReady.value = false

  await nextTick()
  await initWaveform()
}

// 局部拖拽状态
const uploadBoxRef = ref(null)
const localDragging = ref(false)

const onLocalDragLeave = (e) => {
  if (e.currentTarget === e.target) localDragging.value = false
}
const onLocalDrop = (e) => {
  localDragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  const audioFile = files.find(f => fileStore.detectType(f) === 'audio')
  if (audioFile) {
    onFileSelected({ file: audioFile })
  } else if (files.length) {
    showFailToast('请拖入音频文件')
  }
}

// 监听全局拖拽过来的音频文件
watch(() => fileStore.queue.length, async (len) => {
  if (len === 0) return
  const audioItem = fileStore.queue.find(f => f.type === 'audio')
  if (audioItem) {
    fileStore.queue = fileStore.queue.filter(f => f.type !== 'audio')
    await onFileSelected({ file: audioItem.file })
  }
}, { immediate: true })

const initWaveform = () => {
  if (wavesurfer) {
    wavesurfer.destroy()
    wavesurfer = null
    region = null
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = ''
  }
  if (!waveformEl.value || !selectedFile.value) return

  currentObjectUrl = URL.createObjectURL(selectedFile.value)
  regionsPlugin = RegionsPlugin.create()
  const timelinePlugin = TimelinePlugin.create({
    height: 20,
    // 不固定刻度间隔，随缩放自适应；放大后自动显示毫秒刻度
    formatTimeCallback: (sec) => {
      if (sec >= 1) return formatTime(sec)
      if (sec >= 0.1) return sec.toFixed(1) + 's'
      return sec.toFixed(2) + 's'
    },
    style: { fontSize: '10px', color: '#969799' }
  })

  wavesurfer = WaveSurfer.create({
    container: waveformEl.value,
    waveColor: '#c5cad4',
    progressColor: '#1989fa',
    cursorColor: '#ee0a24',
    cursorWidth: 2,
    height: 80,
    url: currentObjectUrl,
    interact: true, // 允许点击波形定位
    plugins: [regionsPlugin, timelinePlugin]
  })

  // 波形解码完成
  wavesurfer.on('ready', () => {
    wavesurferReady.value = true
    duration.value = wavesurfer.getDuration()
    startTime.value = 0
    endTime.value = duration.value
    currentTime.value = 0
    zoomIndex.value = 0
    startTimeText.value = formatTimeMs(0)
    endTimeText.value = formatTimeMs(duration.value)
    addDefaultRegion()
  })

  // 播放状态
  wavesurfer.on('play', () => { isPlaying.value = true })
  wavesurfer.on('pause', () => { isPlaying.value = false })
  wavesurfer.on('stop', () => { isPlaying.value = false })

  // 实时播放进度 + 到达选区终点处理
  wavesurfer.on('audioprocess', (time) => onTimeUpdate(time))
  wavesurfer.on('timeupdate', (time) => onTimeUpdate(time))

  // 点击波形定位游标
  wavesurfer.on('interaction', (time) => {
    currentTime.value = time
  })

  // 选区拖拽/缩放：实时反向同步到输入框/滑块和时间显示
  wavesurfer.on('region-update', (r) => {
    if (isSyncing) return
    isSyncing = true
    startTime.value = r.start
    endTime.value = r.end
    isSyncing = false
  })
}

// 选区被拖动后，确保 start <= end（保护性约束）
const addDefaultRegion = () => {
  if (!regionsPlugin) return
  regionsPlugin.clearRegions()
  region = regionsPlugin.addRegion({
    start: 0,
    end: duration.value,
    color: 'rgba(25, 137, 250, 0.18)',
    drag: true,
    resize: true
  })
}

// 播放时间更新：同步 currentTime 并处理选区终点 / 循环
const onTimeUpdate = (time) => {
  currentTime.value = time
  if (!isPlaying.value) return
  // 播放到选区终点
  if (time >= endTime.value - 0.05) {
    if (loopRegion.value) {
      wavesurfer.setTime(startTime.value)
      wavesurfer.play()
    } else {
      wavesurfer.pause()
    }
  }
}

// 解析时间输入（支持 1.5 / 90 / 1:30 / 1:30.5 / 00:01.500），非法返回 NaN
const parseTimeInput = (str) => {
  const s = String(str ?? '').trim()
  if (!s || !/^\d{1,3}(:\d{1,2}(\.\d{1,3})?)?(\.\d{1,3})?$/.test(s)) return NaN
  if (s.includes(':')) {
    const [m, sec] = s.split(':')
    return (parseInt(m, 10) || 0) * 60 + (parseFloat(sec) || 0)
  }
  return parseFloat(s)
}

// 滑块/输入框（单位秒，毫秒级）-> Region 同步
const onStartTimeInput = (val) => {
  let v = parseFloat(val)
  if (isNaN(v)) return
  v = Math.min(Math.max(0, v), startMax.value)
  startTime.value = v
  if (region && !isSyncing) {
    isSyncing = true
    region.setOptions({ start: v })
    isSyncing = false
  }
}
const onEndTimeInput = (val) => {
  let v = parseFloat(val)
  if (isNaN(v)) return
  v = Math.min(Math.max(endMin.value, v), duration.value)
  endTime.value = v
  if (region && !isSyncing) {
    isSyncing = true
    region.setOptions({ end: v })
    isSyncing = false
  }
}

// 输入框聚焦/失焦：失焦时解析输入并归一化显示
const onStartFocus = () => {
  startFocused.value = true
  startTimeText.value = formatTimeMs(startTime.value)
}
const onStartBlur = () => {
  const sec = parseTimeInput(startTimeText.value)
  if (!isNaN(sec)) onStartTimeInput(sec)
  startFocused.value = false
  startTimeText.value = formatTimeMs(startTime.value)
}
const onEndFocus = () => {
  endFocused.value = true
  endTimeText.value = formatTimeMs(endTime.value)
}
const onEndBlur = () => {
  const sec = parseTimeInput(endTimeText.value)
  if (!isNaN(sec)) onEndTimeInput(sec)
  endFocused.value = false
  endTimeText.value = formatTimeMs(endTime.value)
}

// 播放控制
const togglePlay = () => {
  if (!wavesurfer || !wavesurferReady.value) return
  if (isPlaying.value) {
    wavesurfer.pause()
    return
  }
  const cur = wavesurfer.getCurrentTime()
  // 当前位置在选区内 → 继续播放（到终点由 onTimeUpdate 停止）
  if (cur >= startTime.value && cur < endTime.value - 0.1) {
    wavesurfer.play()
  } else {
    // 从选区起点开始播放
    wavesurfer.play(startTime.value, endTime.value)
  }
}

const stopPlay = () => {
  if (!wavesurfer) return
  wavesurfer.pause()
  wavesurfer.setTime(startTime.value)
}

// 播放位置毫秒级微调（delta 单位秒，如 ±0.1）
const nudgeTime = (delta) => {
  if (!wavesurfer || !wavesurferReady.value) return
  const t = Math.min(Math.max(0, wavesurfer.getCurrentTime() + delta), duration.value)
  wavesurfer.setTime(t)
  currentTime.value = t
}

// 波形缩放：index 对应 ZOOM_LEVELS 等级，0 = 适应全部
// 限流：zoom 会整体重绘波形，高频触发（如双指捏合）会造成画面闪烁/卡顿
let zoomThrottleTimer = 0
let zoomPendingIndex = null
const applyZoom = (idx) => {
  if (!wavesurfer || !wavesurferReady.value) return
  zoomPendingIndex = Math.min(Math.max(0, Math.round(idx)), ZOOM_LEVELS.length - 1)
  zoomIndex.value = zoomPendingIndex
  if (zoomThrottleTimer) return
  zoomThrottleTimer = setTimeout(() => {
    zoomThrottleTimer = 0
    if (zoomPendingIndex !== null && wavesurfer) {
      wavesurfer.zoom(ZOOM_LEVELS[zoomPendingIndex])
    }
  }, 120)
}

// 双指捏合缩放波形（移动端手势）
let pinchStartDist = 0
let pinchStartIndex = 0
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
const onPinchStart = (e) => {
  if (e.touches.length !== 2) return
  pinchStartDist = touchDist(e.touches)
  pinchStartIndex = zoomIndex.value
}
const onPinchMove = (e) => {
  if (e.touches.length !== 2 || !pinchStartDist) return
  e.preventDefault()
  const ratio = touchDist(e.touches) / pinchStartDist
  applyZoom(pinchStartIndex + Math.round(Math.log2(ratio) * 2))
}
const onPinchEnd = () => {
  pinchStartDist = 0
}

const seekToStart = () => {
  if (!wavesurfer) return
  wavesurfer.setTime(startTime.value)
  currentTime.value = startTime.value
}

const playRegion = () => {
  if (!wavesurfer || !wavesurferReady.value) return
  wavesurfer.play(startTime.value, endTime.value)
}

const resetRegion = () => {
  if (!wavesurfer || !duration.value) return
  isSyncing = true
  startTime.value = 0
  endTime.value = duration.value
  if (region) region.setOptions({ start: 0, end: duration.value })
  isSyncing = false
  wavesurfer.setTime(0)
  currentTime.value = 0
}

// 把当前播放游标位置设为选区起点
const setRegionFromCurrent = () => {
  if (!wavesurfer || !region) return
  const cur = wavesurfer.getCurrentTime()
  const newStart = Math.min(cur, endTime.value - 0.1)
  isSyncing = true
  startTime.value = newStart
  region.setOptions({ start: newStart })
  isSyncing = false
}

// 把当前播放游标位置设为选区终点
const setRegionEndFromCurrent = () => {
  if (!wavesurfer || !region) return
  const cur = wavesurfer.getCurrentTime()
  const newEnd = Math.max(cur, startTime.value + 0.1)
  isSyncing = true
  endTime.value = newEnd
  region.setOptions({ end: newEnd })
  isSyncing = false
}

const onProcess = async () => {
  if (!selectedFile.value) return
  if (endTime.value <= startTime.value) {
    showFailToast('结束时间必须大于开始时间')
    return
  }
  // 处理前先停止播放
  if (wavesurfer) wavesurfer.pause()
  processing.value = true
  progressValue.value = 0
  try {
    // 1. 先剪辑
    let blob = await cutAudio(selectedFile.value, startTime.value, endTime.value, 'wav', (p) => {
      progressValue.value = p * 0.5
    })
    // 2. 如果有高级处理选项则二次处理
    const needProcess = processOptions.volume !== 1 || processOptions.speed !== 1 || processOptions.fadeIn || processOptions.fadeOut
    if (needProcess) {
      const tmpFile = new File([blob], 'tmp.wav', { type: 'audio/wav' })
      blob = await processAudio(tmpFile, { ...processOptions, format: format.value }, (p) => {
        progressValue.value = 0.5 + p * 0.5
      })
    } else if (format.value !== 'wav') {
      // 转格式
      const tmpFile = new File([blob], 'tmp.wav', { type: 'audio/wav' })
      blob = await processAudio(tmpFile, { format: format.value }, (p) => {
        progressValue.value = 0.5 + p * 0.5
      })
    }
    resultBlob.value = blob
    resultUrl.value = URL.createObjectURL(blob)
    showSuccessToast('处理成功')
  } catch (e) {
    showFailToast('处理失败：' + e.message)
  } finally {
    processing.value = false
  }
}

const downloadResult = () => {
  downloadBlob(resultBlob.value, generateFilename('cut', format.value))
}

const reset = () => {
  fileList.value = []
  selectedFile.value = null
  resultBlob.value = null
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  if (wavesurfer) {
    wavesurfer.destroy()
    wavesurfer = null
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = ''
  }
  region = null
  wavesurferReady.value = false
  isPlaying.value = false
  currentTime.value = 0
  duration.value = 0
}

onUnmounted(() => {
  if (wavesurfer) wavesurfer.destroy()
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
})
</script>

<style lang="less" scoped>
.audio-cut {
  padding: 10px 0 80px;
}
.upload-box-wrapper {
  width: 100%;
}
.upload-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 30px;
  width: 100%;
  color: #969799;
  border: 2px dashed transparent;
  border-radius: 8px;
  transition: all 0.2s;
  &.is-dragging {
    border-color: #1989fa;
    background: rgba(25, 137, 250, 0.05);
  }
}
.upload-text {
  margin-top: 8px;
  font-size: 14px;
  color: #323233;
}
.upload-hint {
  font-size: 12px;
  margin-top: 4px;
}
.waveform-box {
  position: relative;
  width: 100%;
  min-height: 98px;
  background: #f7f8fa;
  border-radius: 8px;
  padding: 4px 0;
}
.waveform {
  width: 100%;
}
.waveform-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #969799;
  font-size: 12px;
}
.drag-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #969799;
  display: flex;
  align-items: center;
  gap: 4px;
}
// 缩放控制条：横向排布 + 大触控目标（修复此前缺失样式导致的竖排错乱）
.zoom-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 8px;
}
.zoom-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid #ebedf0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  &.disabled {
    opacity: 0.35;
    pointer-events: none;
  }
}
.zoom-label {
  min-width: 84px;
  height: 32px;
  line-height: 30px;
  padding: 0 10px;
  text-align: center;
  font-size: 12px;
  font-family: monospace;
  color: #1989fa;
  background: rgba(25, 137, 250, 0.08);
  border: 1px solid rgba(25, 137, 250, 0.35);
  border-radius: 16px;
  cursor: pointer;
  user-select: none;
}
// 播放控制条：主控制一行、辅助控制一行，按钮均 ≥40px 触控区
.player-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 8px;
}
.player-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 2px;
  padding: 0 8px;
}
.nudge-label {
  font-size: 12px;
  font-weight: bold;
  font-family: monospace;
  color: #1989fa;
}
.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  min-height: 40px;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  &:active {
    opacity: 0.6;
  }
}
.play-btn {
  transition: transform 0.15s;
  &:active {
    transform: scale(0.9);
  }
}
.time-display {
  flex: 1;
  text-align: center;
  font-family: monospace;
  .cur-time {
    font-size: 16px;
    font-weight: bold;
    color: #1989fa;
  }
  .sep {
    margin: 0 6px;
    color: #c8c9cc;
  }
  .dur-time {
    font-size: 13px;
    color: #969799;
  }
}
.loop-btn {
  color: #c8c9cc;
  &.active {
    color: #07c160;
  }
}
.time-value {
  font-family: monospace;
  color: #1989fa;
  font-weight: bold;
}
.region-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
// 主操作按钮吸底：滚动时始终停留在 Tab 栏上方，手机端单手可达
.action-area {
  position: sticky;
  bottom: calc(58px + env(safe-area-inset-bottom, 0px));
  z-index: 99;
  padding: 10px 16px;
  background: linear-gradient(to top, #f7f8fa 75%, rgba(247, 248, 250, 0));
}
.progress-box {
  text-align: center;
}
.progress-hint {
  margin-top: 10px;
  font-size: 13px;
  color: #969799;
}
.result-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
// wavesurfer 选区边界增强（穿透 scoped）
:deep(.region) {
  border-left: 2px solid #1989fa !important;
  border-right: 2px solid #1989fa !important;
  border-radius: 3px;
}
:deep(.region-resize-handle) {
  width: 14px !important;
  background: #1989fa !important;
  border-radius: 3px;
  cursor: ew-resize;
  touch-action: none;
}
</style>
