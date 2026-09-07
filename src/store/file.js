import { defineStore } from 'pinia'

/**
 * 文件识别 + 跨页面传递 store
 * 拖拽/上传的文件先存这里，目标页面 watch 后读取
 */
export const useFileStore = defineStore('file', {
  state: () => ({
    // 当前拖拽/上传的文件队列
    queue: [], // [{ file, type, page }]
    // 全局拖拽遮罩状态
    dragging: false,
    draggingType: '' // 'video' | 'audio' | 'mixed'
  }),
  getters: {
    pendingFile: (state) => state.queue[0] || null
  },
  actions: {
    /**
     * 识别文件类型
     */
    detectType(file) {
      if (!file) return 'unknown'
      const mime = file.type || ''
      const name = (file.name || '').toLowerCase()
      const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v', 'ogv', 'ts']
      const audioExts = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma']
      if (mime.startsWith('video/')) return 'video'
      if (mime.startsWith('audio/')) return 'audio'
      const ext = name.split('.').pop()
      if (videoExts.includes(ext)) return 'video'
      if (audioExts.includes(ext)) return 'audio'
      return 'unknown'
    },

    /**
     * 根据文件类型推荐路由
     */
    getSuggestedRoute(type) {
      if (type === 'video') return '/video-to-audio'
      if (type === 'audio') return '/audio-cut'
      return null
    },

    /**
     * 推入文件队列
     */
    enqueue(file, type) {
      this.queue.push({ file, type })
    },

    /**
     * 消费一个文件（页面读取后清理）
     */
    consumeFile() {
      return this.queue.shift() || null
    },

    /**
     * 清空队列
     */
    clearQueue() {
      this.queue = []
    },

    setDragging(val, type = '') {
      this.dragging = val
      this.draggingType = type
    }
  }
})
