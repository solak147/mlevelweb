<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { fetchOrder } from '../lib/ecpay'

const props = defineProps({
  orderId: { type: String, required: true },
  token: { type: String, required: true },
  status: { type: String, default: 'success' }
})
const emit = defineEmits(['close'])

// 綠界的背景通知（/notify）可能比使用者回跳晚一點點，付款成功時多輪詢幾次
const POLL_INTERVAL = 2000
const MAX_POLLS = 10

const order = ref(null)
const loading = ref(true)
const error = ref('')
const copied = ref(false)

let timer = null
let polls = 0

const load = async () => {
  try {
    const result = await fetchOrder(props.orderId, props.token)
    order.value = result

    if (result.status === 'paid' || props.status !== 'success' || polls >= MAX_POLLS) {
      loading.value = false
      return
    }

    polls += 1
    timer = setTimeout(load, POLL_INTERVAL)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '查詢訂單失敗。'
    loading.value = false
  }
}

const copyKey = async () => {
  if (!order.value?.licenseKey) return
  try {
    await navigator.clipboard.writeText(order.value.licenseKey)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1800)
  } catch {
    error.value = '複製失敗，請手動選取金鑰。'
  }
}

const formatDate = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-TW', { dateStyle: 'long', timeStyle: 'short' })
}

const onKey = (e) => { if (e.key === 'Escape') emit('close') }

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  load()
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="mask">
    <div class="modal card" role="dialog" aria-modal="true" aria-label="付款結果">
      <button class="x" type="button" aria-label="關閉" @click="emit('close')">×</button>

      <!-- 查詢中 -->
      <template v-if="loading">
        <span class="eyebrow">Processing</span>
        <h3>確認付款結果中…</h3>
        <p class="desc">正在向綠界確認這筆交易，請稍候幾秒，不要關閉這個頁面。</p>
        <div class="spinner" aria-hidden="true" />
      </template>

      <!-- 已付款：顯示授權金鑰 -->
      <template v-else-if="order && order.status === 'paid'">
        <span class="eyebrow ok">Success</span>
        <h3>付款完成，授權已開通 🍁</h3>

        <div class="keybox">
          <span class="klabel">你的授權金鑰</span>
          <code class="key">{{ order.licenseKey }}</code>
          <button class="copy" type="button" @click="copyKey">
            {{ copied ? '已複製 ✓' : '複製金鑰' }}
          </button>
        </div>

        <dl class="meta">
          <div><dt>訂單編號</dt><dd>{{ order.orderId }}</dd></div>
          <div><dt>方案</dt><dd>{{ order.productName }}</dd></div>
          <div><dt>金額</dt><dd>NT${{ order.amount }}</dd></div>
          <div v-if="order.email"><dt>綁定信箱</dt><dd>{{ order.email }}</dd></div>
          <div v-if="order.licenseExpiresAt"><dt>有效期限</dt><dd>{{ formatDate(order.licenseExpiresAt) }}</dd></div>
        </dl>

        <a v-if="order.downloadUrl" class="download" :href="order.downloadUrl" rel="noopener">下載 MLevel</a>
        <p v-else class="desc">下載連結尚未設定，請聯絡客服取得程式。</p>

        <p class="note">請把金鑰保存好；首次啟動 MLevel 時輸入它即可完成啟用。</p>
      </template>

      <!-- 未完成 -->
      <template v-else>
        <span class="eyebrow fail">Incomplete</span>
        <h3>這筆付款尚未完成</h3>
        <p class="desc">
          交易未成功或已取消，我們不會向你收取任何費用。
          <template v-if="order"> 訂單編號：{{ order.orderId }}。</template>
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="again" type="button" @click="emit('close')">回到首頁重新購買</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 7, 12, .78);
  backdrop-filter: blur(6px);
  overflow-y: auto;
}
.modal {
  position: relative;
  width: min(520px, 100%);
  padding: 34px 32px;
  background: var(--surface-2);
}
.x {
  position: absolute;
  top: 14px;
  right: 16px;
  background: none;
  border: 0;
  color: var(--muted);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}
.x:hover { color: var(--text); }

.eyebrow.ok { color: var(--ok); }
.eyebrow.fail { color: #ff8a80; }

h3 { margin: 10px 0 16px; font-size: 24px; }
.desc { color: var(--muted); font-size: 14.5px; }

.spinner {
  width: 32px;
  height: 32px;
  margin: 26px auto 6px;
  border: 3px solid var(--line);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin .9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s } }

.keybox {
  margin-top: 8px;
  padding: 20px;
  border-radius: 14px;
  text-align: center;
  background: rgba(255, 138, 31, .1);
  border: 1px solid rgba(255, 138, 31, .3);
}
.klabel { display: block; font-size: 13px; color: var(--muted); }
.key {
  display: block;
  margin: 10px 0 16px;
  font-size: clamp(17px, 4.4vw, 23px);
  font-weight: 900;
  letter-spacing: .08em;
  color: var(--brand-2);
  word-break: break-all;
  user-select: all;
}
.copy {
  padding: 9px 20px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.copy:hover { border-color: var(--brand); color: var(--brand-2); }

.meta { margin: 22px 0 0; display: grid; gap: 10px; }
.meta > div { display: flex; justify-content: space-between; gap: 16px; font-size: 14px; }
.meta dt { color: var(--muted); flex: none; }
.meta dd { margin: 0; text-align: right; word-break: break-all; }

.download {
  display: block;
  margin-top: 24px;
  padding: 16px 24px;
  border-radius: 999px;
  text-align: center;
  text-decoration: none;
  font-size: 16px;
  font-weight: 900;
  color: var(--brand-ink);
  background: linear-gradient(100deg, var(--brand-2), var(--brand));
  box-shadow: var(--shadow-brand);
}

.again {
  width: 100%;
  margin-top: 22px;
  padding: 15px 24px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.again:hover { border-color: var(--brand); }

.error {
  margin-top: 16px;
  padding: 11px 14px;
  border-radius: 10px;
  background: rgba(255, 90, 77, .12);
  border: 1px solid rgba(255, 90, 77, .35);
  color: #ff9d94;
  font-size: 13.5px;
}

.note { margin-top: 18px; font-size: 12.5px; color: #7c88a3; }
</style>
