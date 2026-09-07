import { onMounted, onBeforeUnmount } from 'vue'
import { useFileStore } from '../store/file'
import { useRouter } from 'vue-router'

/**
 * 全局文件拖拽 composable
 * 在 App.vue 中调用一次即可启用全局拖拽能力
 * - 拖拽进页面时显示遮罩 + 类型提示
 * - 松开时自动识别文件类型并路由到对应页面
 */
export function useGlobalDragDrop() {
  const store = useFileStore()
  const router = useRouter()

  let dragDepth = 0

  const onDragEnter = (e) => {
    e.preventDefault()
    dragDepth++
    if (dragDepth !== 1) return
    // 检查是否带文件
    const types = e.dataTransfer?.types
    if (!types || !Array.from(types).includes('Files')) return
    store.setDragging(true)
  }

  const onDragOver = (e) => {
    e.preventDefault()
    if (!store.dragging) dragDepth = 0
  }

  const onDragLeave = (e) => {
    e.preventDefault()
    dragDepth--
    if (dragDepth <= 0) {
      dragDepth = 0
      store.setDragging(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    dragDepth = 0
    store.setDragging(false)
    const files = Array.from(e.dataTransfer?.files || [])
    if (!files.length) return

    // 识别所有文件类型
    const types = files.map(f => store.detectType(f))
    const hasVideo = types.includes('video')
    const hasAudio = types.includes('audio')

    // 推入 store
    files.forEach((file, i) => store.enqueue(file, types[i]))

    // 路由到对应页面
    let targetRoute
    if (hasVideo && !hasAudio) {
      targetRoute = '/video-to-audio'
    } else if (hasAudio && !hasVideo) {
      targetRoute = files.length > 1 ? '/audio-merge' : '/audio-cut'
    } else if (hasVideo && hasAudio) {
      // 混合：优先视频（用户拖视频更常见）
      targetRoute = '/video-to-audio'
    } else {
      // 未知类型
      targetRoute = '/home'
    }

    if (targetRoute) {
      router.push(targetRoute)
    }
  }

  onMounted(() => {
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('dragenter', onDragEnter)
    document.removeEventListener('dragover', onDragOver)
    document.removeEventListener('dragleave', onDragLeave)
    document.removeEventListener('drop', onDrop)
  })

  return {
    isDragging: store.dragging,
    draggingType: store.draggingType
  }
}

/**
 * 页面内局部拖拽 composable
 * 给 upload-box 用：仅当拖拽目标在 upload-box 上时才处理
 * @param {Object} handlers { onFiles(files), accept: 'video'|'audio'|'any' }
 */
export function useLocalDrop(elRef, handlers = {}) {
  let isInside = false

  const onDragEnter = (e) => {
    e.preventDefault()
    isInside = true
    if (elRef.value) elRef.value.classList.add('is-dragging')
  }
  const onDragOver = (e) => {
    e.preventDefault()
  }
  const onDragLeave = (e) => {
    // dragleave 会在子元素触发，判断是否真的离开
    if (e.currentTarget === e.target) {
      isInside = false
      if (elRef.value) elRef.value.classList.remove('is-dragging')
    }
  }
  const onDrop = (e) => {
    e.preventDefault()
    isInside = false
    if (elRef.value) elRef.value.classList.remove('is-dragging')
    const files = Array.from(e.dataTransfer?.files || [])
    if (!files.length) return
    // 过滤：只接受符合类型的文件
    const store = useFileStore()
    const accepted = files.filter(f => {
      const t = store.detectType(f)
      if (handlers.accept === 'video') return t === 'video'
      if (handlers.accept === 'audio') return t === 'audio'
      return true
    })
    if (handlers.onFiles && accepted.length) {
      handlers.onFiles(accepted)
    }
  }

  onMounted(() => {
    if (!elRef.value) return
    const el = elRef.value
    el.addEventListener('dragenter', onDragEnter)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
  })

  onBeforeUnmount(() => {
    if (!elRef.value) return
    const el = elRef.value
    el.removeEventListener('dragenter', onDragEnter)
    el.removeEventListener('dragover', onDragOver)
    el.removeEventListener('dragleave', onDragLeave)
    el.removeEventListener('drop', onDrop)
  })
}
