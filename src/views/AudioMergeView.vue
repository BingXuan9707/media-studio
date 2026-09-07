<template>
  <div class="audio-merge">
    <!-- 上传多个音频 -->
    <van-cell-group inset title="1. 选择音频文件（可多个）">
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
              multiple
              :after-read="onFilesSelected"
              accept="audio/*"
              result-type="file"
            >
              <div class="upload-box" :class="{ 'is-dragging': localDragging }">
                <van-icon name="apps-o" size="40" />
                <div class="upload-text">点击选择 或 拖拽多个音频文件到这里</div>
                <div class="upload-hint">支持多选，按顺序合并</div>
              </div>
            </van-uploader>
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 文件列表 -->
    <van-cell-group v-if="audioList.length" inset title="2. 调整合并顺序">
      <van-cell
        v-for="(item, index) in audioList"
        :key="index"
      >
        <template #title>
          <div class="file-row">
            <div class="order-num">{{ index + 1 }}</div>
            <div class="file-info">
              <div class="file-name">{{ item.file.name }}</div>
              <div class="file-meta">{{ formatSize(item.file.size) }} · {{ formatTime(item.duration) }}</div>
            </div>
            <div class="file-actions">
              <van-button
                size="mini"
                icon="arrow-up"
                :disabled="index === 0"
                @click="moveUp(index)"
              />
              <van-button
                size="mini"
                icon="arrow-down"
                :disabled="index === audioList.length - 1"
                @click="moveDown(index)"
              />
              <van-button
                size="mini"
                type="danger"
                icon="cross"
                @click="removeAt(index)"
              />
            </div>
          </div>
        </template>
      </van-cell>
      <van-cell title="总时长">
        <template #value>
          <van-tag type="primary">{{ formatTime(totalDuration) }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 输出选项 -->
    <van-cell-group v-if="audioList.length" inset title="3. 输出格式">
      <van-cell>
        <template #title>
          <div class="format-list">
            <div
              v-for="fmt in formats"
              :key="fmt"
              class="format-item"
              :class="{ active: selectedFormat === fmt }"
              @click="selectedFormat = fmt"
            >
              {{ fmt.toUpperCase() }}
            </div>
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 操作 -->
    <div class="action-area">
      <van-button
        type="primary"
        block
        round
        :disabled="!audioList.length || merging"
        :loading="merging"
        loading-text="合并中..."
        @click="onMerge"
      >
        开始合并
      </van-button>
    </div>

    <!-- 结果 -->
    <van-cell-group v-if="merging || resultBlob" inset title="4. 合并结果">
      <van-cell>
        <template #title>
          <div v-if="merging" class="progress-box">
            <van-progress :percentage="progressPercent" />
            <div class="progress-hint">正在合并 {{ audioList.length }} 个音频...</div>
          </div>
          <div v-else-if="resultBlob" class="result-box">
            <audio :src="resultUrl" controls style="width:100%"></audio>
            <div class="result-meta">
              <van-tag type="success">{{ selectedFormat.toUpperCase() }}</van-tag>
              <span class="size">{{ formatSize(resultBlob.size) }}</span>
            </div>
            <div class="result-actions">
              <van-button type="primary" size="small" icon="down" @click="downloadResult">下载</van-button>
              <van-button size="small" @click="reset">重新合并</van-button>
            </div>
          </div>
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { mergeAudios } from '../utils/ffmpeg'
import { formatSize, formatTime, getMediaDuration, downloadBlob, generateFilename } from '../utils/audio'
import { useFileStore } from '../store/file'

const fileStore = useFileStore()

const fileList = ref([])
const audioList = ref([])
const selectedFormat = ref('mp3')
const formats = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac']
const merging = ref(false)
const progressValue = ref(0)
const resultBlob = ref(null)
const resultUrl = ref('')

const progressPercent = computed(() => Math.round(progressValue.value * 100))
const totalDuration = computed(() => audioList.value.reduce((s, i) => s + (i.duration || 0), 0))

const onFilesSelected = async (fileItems) => {
  for (const item of fileItems) {
    const duration = await getMediaDuration(item.file)
    audioList.value.push({ file: item.file, duration })
  }
}

// 局部拖拽状态
const uploadBoxRef = ref(null)
const localDragging = ref(false)

const onLocalDragLeave = (e) => {
  if (e.currentTarget === e.target) localDragging.value = false
}
const onLocalDrop = async (e) => {
  localDragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  const audioFiles = files.filter(f => fileStore.detectType(f) === 'audio')
  if (audioFiles.length) {
    for (const f of audioFiles) {
      const duration = await getMediaDuration(f)
      audioList.value.push({ file: f, duration })
    }
  } else if (files.length) {
    showFailToast('请拖入音频文件')
  }
}

// 监听全局拖拽过来的音频文件
watch(() => fileStore.queue.length, async (len) => {
  if (len === 0) return
  const audioItems = fileStore.queue.filter(f => f.type === 'audio')
  if (audioItems.length) {
    fileStore.queue = fileStore.queue.filter(f => f.type !== 'audio')
    for (const item of audioItems) {
      const duration = await getMediaDuration(item.file)
      audioList.value.push({ file: item.file, duration })
    }
  }
}, { immediate: true })

const moveUp = (index) => {
  if (index <= 0) return
  const arr = audioList.value
  ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
}
const moveDown = (index) => {
  if (index >= audioList.value.length - 1) return
  const arr = audioList.value
  ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
}
const removeAt = (index) => {
  audioList.value.splice(index, 1)
}

const onMerge = async () => {
  if (audioList.value.length < 2) {
    showFailToast('至少需要 2 个音频文件')
    return
  }
  merging.value = true
  progressValue.value = 0
  try {
    const blob = await mergeAudios(
      audioList.value.map(i => i.file),
      selectedFormat.value,
      (p) => { progressValue.value = p }
    )
    resultBlob.value = blob
    resultUrl.value = URL.createObjectURL(blob)
    showSuccessToast('合并成功')
  } catch (e) {
    showFailToast('合并失败：' + e.message)
  } finally {
    merging.value = false
  }
}

const downloadResult = () => {
  downloadBlob(resultBlob.value, generateFilename('merged', selectedFormat.value))
}

const reset = () => {
  fileList.value = []
  audioList.value = []
  resultBlob.value = null
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
}

onUnmounted(() => {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
})
</script>

<style lang="less" scoped>
.audio-merge {
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
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.order-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #1989fa;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}
.file-info {
  flex: 1;
  min-width: 0;
}
.file-name {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-meta {
  font-size: 12px;
  color: #969799;
  margin-top: 2px;
}
.file-actions {
  display: flex;
  gap: 4px;
}
.format-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.format-item {
  padding: 6px 18px;
  border: 1px solid #dcdee0;
  border-radius: 20px;
  font-size: 13px;
  &.active {
    background: #1989fa;
    color: #fff;
    border-color: #1989fa;
  }
}
.action-area {
  padding: 16px;
}
.progress-box {
  text-align: center;
}
.progress-hint {
  margin-top: 10px;
  font-size: 13px;
  color: #969799;
}
.result-meta {
  margin: 10px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.result-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
</style>
