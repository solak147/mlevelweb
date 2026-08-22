import { initializeApp } from 'firebase/app'
// import { getAnalytics, isSupported } from 'firebase/analytics'

// 前端 Firebase 設定。這些值本來就會出現在瀏覽器裡，屬於公開資訊，
// 真正的機密（綠界 HashKey/HashIV）只存在 functions/.env。
const firebaseConfig = {
  apiKey: 'AIzaSyAelwk4wrtS5tT4XpL7ygOAr_h_U-_N3P8',
  authDomain: 'mlevel-f575a.firebaseapp.com',
  projectId: 'mlevel-f575a',
  storageBucket: 'mlevel-f575a.firebasestorage.app',
  messagingSenderId: '902628697174',
  appId: '1:902628697174:web:8e59f61646fb291e4b87f7',
  measurementId: 'G-R036YF0S85'
}

export const app = initializeApp(firebaseConfig)

// Analytics 暫時停用。要啟用時解開下面這段，並解開 main.js 的 import('./firebase')。
// 只在支援的瀏覽器環境啟用（無痕模式、部分瀏覽器不支援），
// 且開發模式不送資料，避免污染正式報表。
// if (import.meta.env.PROD) {
//   isSupported()
//     .then((supported) => {
//       if (supported) getAnalytics(app)
//     })
//     .catch(() => {
//       // Analytics 起不來不該影響網站運作
//     })
// }
