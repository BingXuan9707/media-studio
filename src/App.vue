<template>
  <div class="app-container">
    <!-- 全局拖拽遮罩 -->
    <transition name="fade">
      <div v-if="isDragging" class="global-drop-overlay">
        <div class="overlay-content">
          <van-icon name="add-o" size="72" color="#1989fa" />
          <div class="overlay-title">松开以导入文件</div>
          <div class="overlay-desc">
            检测到 {{ dragFileCount }} 个文件 · {{ dragSummary }}
          </div>
          <div class="overlay-hint">自动识别类型并跳转到对应处理页面</div>
        </div>
      </div>
    </transition>

    <!-- 顶部导航 -->
    <van-nav-bar
      :title="currentTitle"
      :left-arrow="showBack"
      @click-left="onBack"
      fixed
      placeholder
    />
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>

    <!-- 底部 Tab 导航（route 模式自动跟随路由） -->
    <van-tabbar route fixed placeholder>
      <van-tabbar-item v-for="item in tabs" :key="item.path" :to="item.path" :icon="item.icon">
        {{ item.name }}
      </van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGlobalDragDrop } from './composables/useDragDrop'
import { useFileStore } from './store/file'

// 底部导航配置：5个核心功能
const tabs = [
  { name: '首页', path: '/home', icon: 'home-o' },
  { name: '剪辑', path: '/audio-cut', icon: 'music-o' },
  { name: '合并', path: '/audio-merge', icon: 'apps-o' },
  { name: '链接', path: '/link-download', icon: 'down' },
  { name: '曲库', path: '/music-search', icon: 'search' }
]

const route = useRoute()
const router = useRouter()
const fileStore = useFileStore()

// 启用全局拖拽
const { isDragging } = useGlobalDragDrop()

// 监听文件队列变化，生成拖拽遮罩的摘要
const dragFileCount = computed(() => fileStore.queue.length)
const dragSummary = computed(() => {
  const videoCount = fileStore.queue.filter(f => f.type === 'video').length
  const audioCount = fileStore.queue.filter(f => f.type === 'audio').length
  const parts = []
  if (videoCount) parts.push(`${videoCount} 个视频`)
  if (audioCount) parts.push(`${audioCount} 个音频`)
  return parts.join(' + ') || '未知类型'
})

const currentTitle = computed(() => {
  if (route.meta?.title) return route.meta.title
  const tab = tabs.find(t => t.path === route.path)
  return tab ? tab.name : '音视频处理工具'
})

const showBack = computed(() => !tabs.some(t => t.path === route.path))

const onBack = () => router.back()
</script>

<style lang="less">
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f7f8fa;
  -webkit-tap-highlight-color: transparent;
}

.app-container {
  min-height: 100vh;
  padding-bottom: 20px;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

// 全局拖拽遮罩
.global-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(25, 137, 250, 0.15);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.overlay-content {
  text-align: center;
  padding: 40px 60px;
  border: 3px dashed #1989fa;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.95);
  pointer-events: none;
  animation: pulse 1.2s ease-in-out infinite;
}
.overlay-title {
  font-size: 22px;
  font-weight: bold;
  color: #1989fa;
  margin: 12px 0 6px;
}
.overlay-desc {
  font-size: 14px;
  color: #323233;
  margin-bottom: 4px;
}
.overlay-hint {
  font-size: 12px;
  color: #969799;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(25, 137, 250, 0.4); }
  50% { transform: scale(1.02); box-shadow: 0 0 0 12px rgba(25, 137, 250, 0); }
}
</style>
