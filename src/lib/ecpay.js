// 後端 Cloud Functions（ecpayApi）的 base URL，見 .env / .env.example
const API_BASE_URL = import.meta.env.VITE_ECPAY_API_URL || ''

const normalizeBaseUrl = (baseUrl) => baseUrl.trim().replace(/\/+$/, '')

const buildUrl = (path) => {
  if (!API_BASE_URL) {
    throw new Error('尚未設定 VITE_ECPAY_API_URL，無法連線到付款服務。')
  }
  return new URL(path.replace(/^\/+/, ''), `${normalizeBaseUrl(API_BASE_URL)}/`).toString()
}

/**
 * 呼叫後端建立綠界訂單，取得結帳頁 action 與需 POST 的表單欄位。
 */
export async function createEcpayOrder(payload) {
  const response = await fetch(buildUrl('create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `建立訂單失敗（HTTP ${response.status}）`)
  }

  return data
}

/**
 * 綠界結帳需以 form POST 導向，這裡動態建立隱藏表單並送出。
 */
export function submitEcpayForm(action, params) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = action
  form.style.display = 'none'
  form.acceptCharset = 'utf-8'

  Object.entries(params).forEach(([name, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  })

  document.body.appendChild(form)
  form.submit()
}

/**
 * 付款回跳後查詢訂單狀態與授權金鑰。
 */
export async function fetchOrder(orderId, token) {
  const url = new URL(buildUrl('order'))
  url.searchParams.set('orderId', orderId)
  url.searchParams.set('token', token)

  const response = await fetch(url.toString())
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `查詢訂單失敗（HTTP ${response.status}）`)
  }

  return data.order
}

/**
 * 用 Email + 授權金鑰找回訂單。
 * 付款回跳的網址關掉後，這是使用者自己拿回金鑰與下載連結的入口。
 */
export async function lookupLicense(payload) {
  const response = await fetch(buildUrl('lookup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `查詢授權失敗（HTTP ${response.status}）`)
  }

  return data
}
