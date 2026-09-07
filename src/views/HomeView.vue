<template>
  <div class="home-view">
    <!-- 顶部介绍 -->
    <div class="hero-section">
      <div class="hero-title">音视频处理工具</div>
      <div class="hero-subtitle">手机端 / 电脑端通用 · 浏览器内本地处理 · 隐私安全</div>
      <van-notice-bar left-icon="info-o" :scrollable="false">
        所有处理均在浏览器内完成，文件不会上传服务器
      </van-notice-bar>
    </div>

    <!-- 功能入口 -->
    <van-cell-group inset title="核心功能">
      <van-cell
        v-for="item in features"
        :key="item.path"
        :title="item.name"
        :label="item.desc"
        is-link
        @click="goTo(item.path)"
      >
        <template #icon>
          <div class="feature-icon" :style="{ background: item.color }">
            <van-icon :name="item.icon" />
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 使用说明 -->
    <van-cell-group inset title="使用说明">
      <van-cell title="浏览器要求">
        <template #label>
          推荐 Chrome / Edge / Safari 最新版本。首次处理时需加载约 30MB 的 FFmpeg 引擎。
        </template>
      </van-cell>
      <van-cell title="支持的格式">
        <template #label>
          输入：MP4/MOV/AVI/MKV/MP3/WAV/AAC/M4A 等<br />
          输出：MP3/WAV/AAC/M4A/OGG/FLAC
        </template>
      </van-cell>
      <van-cell title="手机访问">
        <template #label>
          电脑端运行后，手机用浏览器访问本机 IP:5173 即可使用
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

const features = [
  { name: '视频转音频', desc: '从视频文件提取音频轨道', path: '/video-to-audio', icon: 'video-o', color: 'linear-gradient(135deg,#1989fa,#0c6eff)' },
  { name: '音频剪辑', desc: '截取音频指定时间段', path: '/audio-cut', icon: 'music-o', color: 'linear-gradient(135deg,#07c160,#06ad56)' },
  { name: '音频合并', desc: '将多个音频拼接为一个', path: '/audio-merge', icon: 'apps-o', color: 'linear-gradient(135deg,#ff976a,#ee0a24)' },
  { name: '音频处理', desc: '音量/变速/淡入淡出', path: '/audio-cut', icon: 'tosend', color: 'linear-gradient(135deg,#7232dd,#a845de)' },
  { name: '链接下载', desc: '粘贴链接播放并下载', path: '/link-download', icon: 'down', color: 'linear-gradient(135deg,#f90,#ff6600)' }
]

const goTo = (path) => router.push(path)
</script>

<style lang="less" scoped>
.home-view {
  padding: 16px 0 80px;
}
.hero-section {
  text-align: center;
  padding: 30px 20px 20px;
  background: linear-gradient(135deg, #1989fa, #0c6eff);
  color: #fff;
  margin: 0 0 16px;
}
.hero-title {
  font-size: 26px;
  font-weight: bold;
  margin-bottom: 8px;
}
.hero-subtitle {
  font-size: 13px;
  opacity: 0.9;
  margin-bottom: 16px;
}
.feature-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  color: #fff;
  font-size: 20px;
}
:deep(.van-cell__title) {
  flex: 1;
}
</style>
