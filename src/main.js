import { createApp } from 'vue'
import App from './App.vue'
import './assets/style.css'

createApp(App).mount('#app')

// Firebase Analytics 暫時停用（見 src/firebase.js）。
// 要啟用時解開下面這行，會在掛載後非同步載入，不佔首屏 bundle。
// import('./firebase')
