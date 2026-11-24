import { createRouter, createWebHashHistory } from 'vue-router'

// 路由配置：5个核心功能页 + 首页
const routes = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'Home', component: () => import('../views/HomeView.vue'), meta: { title: '音视频处理工具' } },
  { path: '/video-to-audio', name: 'VideoToAudio', component: () => import('../views/VideoToAudioView.vue'), meta: { title: '视频转音频' } },
  { path: '/audio-cut', name: 'AudioCut', component: () => import('../views/AudioCutView.vue'), meta: { title: '音频剪辑' } },
  { path: '/audio-merge', name: 'AudioMerge', component: () => import('../views/AudioMergeView.vue'), meta: { title: '音频合并' } },
  { path: '/link-download', name: 'LinkDownload', component: () => import('../views/LinkDownloadView.vue'), meta: { title: '链接下载' } },
  { path: '/music-search', name: 'MusicSearch', component: () => import('../views/MusicSearchView.vue'), meta: { title: '曲库搜索' } }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
