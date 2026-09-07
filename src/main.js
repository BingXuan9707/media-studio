import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import pinia from './store'
// 全量引入 Vant 样式（Vant 4 默认提供编译后的 CSS，函数式 API 也依赖此样式）
import 'vant/lib/index.css'

// Vant 组件通过 unplugin-vue-components + VantResolver 自动按需引入（含样式）
// 函数式 API（showToast/showDialog 等）的样式由 VantResolver 自动注入

const app = createApp(App)
app.use(pinia)
app.use(router)
app.mount('#app')
