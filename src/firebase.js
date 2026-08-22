import { initializeApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
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

// App Check（reCAPTCHA Enterprise）：讓後端能分辨「請求來自這個網站」還是
// 「有人自己組 request 打 ecpayApi」。正式站的 site key 放 .env.production 的
// VITE_FIREBASE_APPCHECK_SITE_KEY；本機開發用 Firebase Console 註冊的 debug token
// （.env.development 的 VITE_FIREBASE_APPCHECK_DEBUG_TOKEN），沒設就讓 SDK 自己印一組出來。
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY
const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN
const isDevelopment = import.meta.env.DEV

if (isDevelopment && typeof window !== 'undefined') {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken || true
}

let appCheck = null

if (appCheckSiteKey && typeof window !== 'undefined') {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  })
} else if (!isDevelopment) {
  console.warn('Firebase App Check is not initialized because VITE_FIREBASE_APPCHECK_SITE_KEY is missing.')
}

/**
 * 組出呼叫後端 ecpayApi 要帶的 App Check 標頭。
 * 拿不到 token（沒設 site key、reCAPTCHA 載不起來、離線）就回空物件 ——
 * 後端在未強制模式下仍會放行，不會因為 App Check 壞掉就讓整個結帳流程卡住。
 */
export async function getAppCheckHeaders() {
  if (!appCheck) {
    return {}
  }

  try {
    const { token } = await getToken(appCheck, false)
    return token ? { 'X-Firebase-AppCheck': token } : {}
  } catch (error) {
    console.warn('Failed to obtain a Firebase App Check token.', error)
    return {}
  }
}

// Analytics 暫時停用。要啟用時解開下面這段。
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
