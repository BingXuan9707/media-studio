<template>
  <div class="video-to-audio">
    <!-- 上传区域 -->
    <van-cell-group inset title="1. 选择视频文件">
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
              accept="video/*"
              result-type="file"
            >
              <div class="upload-box" :class="{ 'is-dragging': localDragging }">
                <van-icon name="video-o" size="40" />
                <div class="upload-text">点击选择 或 拖拽视频文件到这里</div>
                <div class="upload-hint">支持 MP4/MOV/AVI/MKV 等</div>
              </div>
            </van-uploader>
          </div>
        </template>
      </van-cell>

      <van-cell v-if="selectedFile" title="已选择">
        <template #label>
          <div>{{ selectedFile.name }}</div>
          <div class="file-meta">{{ formatSize(selectedFile.size) }} · {{ formatTime(duration) }}</div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 输出格式选择 -->
    <van-cell-group inset title="2. 选择输出音频格式">
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

    <!-- 转换按钮 -->
    <div class="action-area">
      <van-button
        type="primary"
        block
        round
        :disabled="!selectedFile || converting"
        :loading="converting"
        loading-text="正在转换..."
        @click="onConvert"
      >
        {{ converting ? '转换中' : '开始转换' }}
      </van-button>
    </div>

    <!-- 转换进度 -->
    <van-cell-group v-if="converting || resultBlob" inset title="3. 转换结果">
      <van-cell>
        <template #title>
          <div v-if="converting" class="progress-box">
            <van-progress :percentage="progressPercent" :show-pivot="true" />
            <div class="progress-hint">FFmpeg 正在提取音频...</div>
          </div>
          <div v-else-if="resultBlob" class="result-box">
            <audio :src="resultUrl" controls style="width:100%"></audio>
            <div class="result-meta">
              <van-tag type="success">{{ selectedFormat.toUpperCase() }}</van-tag>
              <span class="size">{{ formatSize(resultBlob.size) }}</span>
            </div>
            <div class="result-actions">
              <van-button type="primary" size="small" icon="down" @click="downloadResult">下载文件</van-button>
              <van-button size="small" @click="reset">重新转换</van-button>
            </div>
          </div>
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { videoToAudio } from '../utils/ffmpeg'
import { formatSize, formatTime, getMediaDuration, downloadBlob, generateFilename } from '../utils/audio'
import { useFileStore } from '../store/file'

const fileStore = useFileStore()
const fileList = ref([])
const selectedFile = ref(null)
const duration = ref(0)
const selectedFormat = ref('mp3')
const formats = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac']
const converting = ref(false)
const progressValue = ref(0)
const resultBlob = ref(null)
const resultUrl = ref('')

// 局部拖拽状态
const uploadBoxRef = ref(null)
const localDragging = ref(false)

const progressPercent = computed(() => Math.round(progressValue.value * 100))

// 处理文件（统一入口）
const handleFile = async (file) => {
  selectedFile.value = file
  fileList.value = [{ file }]
  resultBlob.value = null
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  progressValue.value = 0
  duration.value = await getMediaDuration(file)
}

const onFileSelected = async (fileItem) => {
  await handleFile(fileItem.file)
}

// 局部拖拽处理
const onLocalDragLeave = (e) => {
  if (e.currentTarget === e.target) localDragging.value = false
}
const onLocalDrop = (e) => {
  localDragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  const videoFile = files.find(f => fileStore.detectType(f) === 'video')
  if (videoFile) {
    handleFile(videoFile)
  } else if (files.length) {
    showFailToast('请拖入视频文件')
  }
}

// 监听全局拖拽过来的文件
watch(() => fileStore.queue.length, async (len) => {
  if (len === 0) return
  // 检查是否有视频文件
  const videoItem = fileStore.queue.find(f => f.type === 'video')
  if (videoItem) {
    // 消费 queue 里的视频（保留非视频文件给其他页面）
    fileStore.queue = fileStore.queue.filter(f => f.type !== 'video')
    await handleFile(videoItem.file)
  }
}, { immediate: true })

const onConvert = async () => {
  if (!selectedFile.value) return
  converting.value = true
  progressValue.value = 0
  try {
    const blob = await videoToAudio(selectedFile.value, selectedFormat.value, (p) => {
      progressValue.value = p
    })
    resultBlob.value = blob
    resultUrl.value = URL.createObjectURL(blob)
    showSuccessToast('转换成功')
  } catch (e) {
    showFailToast('转换失败：' + (e.message || '未知错误'))
  } finally {
    converting.value = false
  }
}

const downloadResult = () => {
  downloadBlob(resultBlob.value, generateFilename('audio', selectedFormat.value))
}

const reset = () => {
  fileList.value = []
  selectedFile.value = null
  resultBlob.value = null
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  duration.value = 0
}

onUnmounted(() => {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
})
</script>

<style lang="less" scoped>
.video-to-audio {
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
.file-meta {
  margin-top: 4px;
  color: #969799;
  font-size: 12px;
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
  cursor: pointer;
  transition: all 0.2s;
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
  .size {
    color: #969799;
    font-size: 13px;
  }
}
.result-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
</style>
