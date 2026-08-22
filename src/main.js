import { createApp } from 'vue'
import App from './App.vue'
import './assets/style.css'
// App Check 要在第一次呼叫後端之前就啟動（reCAPTCHA 取 token 需要暖機時間），
// 所以這裡同步載入 firebase.js，不用非同步 import()。
import './firebase'

createApp(App).mount('#app')
