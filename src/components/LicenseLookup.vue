<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { lookupLicense } from '../lib/ecpay'

const emit = defineEmits(['close'])

const email = ref('')
const licenseKey = ref('')
const loading = ref(false)
const error = ref('')
const order = ref(null)
const copied = ref(false)

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim()))
// 後端會自己補 MLV- 前綴與分組，這裡只要確認長度像一組完整金鑰
const keyValid = computed(() => licenseKey.value.replace(/[^A-Za-z0-9]/g, '').length >= 16)
const canSubmit = computed(() => emailValid.value && keyValid.value && !loading.value)

const submit = async () => {
  if (!canSubmit.value) {
    error.value = emailValid.value ? '請填寫完整的授權金鑰。' : '請填寫購買時使用的 Email。'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const result = await lookupLicense({
      email: email.value.trim(),
      licenseKey: licenseKey.value.trim()
    })
    order.value = result.order
  } catch (e) {
    error.value = e instanceof Error ? e.message : '查詢失敗，請稍後再試。'
  } finally {
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

const onKey = (e) => { if (e.key === 'Escape' && !loading.value) emit('close') }

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="mask" @click.self="!loading && emit('close')">
    <div class="modal card" role="dialog" aria-modal="true" aria-label="找回授權與下載連結">
      <button class="x" type="button" aria-label="關閉" :disabled="loading" @click="emit('close')">×</button>

      <!-- 查詢表單 -->
      <template v-if="!order">
        <span class="eyebrow">Recover</span>
        <h3>找回授權與下載</h3>
        <p class="desc">輸入購買時填的 Email 與授權金鑰，就能重新取得安裝檔與使用手冊的下載連結，以及授權有效期限。</p>

        <form class="form" @submit.prevent="submit">
          <label class="field">
            <span class="label">Email</span>
            <input
              v-model="email"
              type="email"
              name="email"
              autocomplete="email"
              placeholder="you@example.com"
              :disabled="loading"
              required
            />
          </label>

          <label class="field spaced">
            <span class="label">授權金鑰</span>
            <input
              v-model="licenseKey"
              type="text"
              name="licenseKey"
              autocomplete="off"
              spellcheck="false"
              placeholder="MLV-XXXX-XXXX-XXXX-XXXX"
              :disabled="loading"
              required
            />
            <span class="hint">大小寫與連字號可以不用管，貼上就好。</span>
          </label>

          <p v-if="error" class="error" role="alert">{{ error }}</p>

          <button class="submit" type="submit" :disabled="!canSubmit">
            {{ loading ? '查詢中…' : '查詢我的授權' }}
          </button>
        </form>

        <p class="note">金鑰也弄丟了的話，請帶著訂單編號或付款紀錄聯絡客服。</p>
      </template>

      <!-- 查到了 -->
      <template v-else>
        <span class="eyebrow ok">Found</span>
        <h3>找到你的授權了 🍁</h3>

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
          <div v-if="order.email"><dt>綁定信箱</dt><dd>{{ order.email }}</dd></div>
          <div v-if="order.licenseExpiresAt"><dt>有效期限</dt><dd>{{ formatDate(order.licenseExpiresAt) }}</dd></div>
        </dl>

        <div v-if="order.downloadUrl" class="files">
          <a class="download" :href="order.downloadUrl" rel="noopener">下載最新版安裝檔（mlevel.zip）</a>
          <a v-if="order.manualUrl" class="download secondary" :href="order.manualUrl" rel="noopener">下載使用手冊（使用手冊.md）</a>
        </div>
        <p v-else-if="order.licenseExpired" class="desc spaced">授權已到期，重新購買後即可再次下載。</p>
        <p v-else class="desc spaced">下載連結尚未設定，請聯絡客服取得程式。</p>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p class="note">這個頁面隨時可以回來查，安裝檔與使用手冊的連結永遠指向最新版本。</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 7, 12, .72);
  backdrop-filter: blur(6px);
  animation: fade .16s ease;
  overflow-y: auto;
}
.modal {
  position: relative;
  width: min(460px, 100%);
  padding: 34px 32px;
  background: var(--surface-2);
  animation: rise .2s ease;
}
@keyframes fade { from { opacity: 0 } }
@keyframes rise { from { opacity: 0; transform: translateY(10px) } }

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
.x:disabled { opacity: .4; cursor: not-allowed; }

.eyebrow.ok { color: var(--ok); }
h3 { margin: 10px 0 12px; font-size: 24px; }
.desc { color: var(--muted); font-size: 14.5px; }
.desc.spaced { margin-top: 22px; }

.form { margin-top: 22px; }
.field { display: block; }
.field.spaced { margin-top: 18px; }
.label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 700; }
.field input {
  width: 100%;
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 15px;
}
.field input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(255, 138, 31, .18);
}
.field input:disabled { opacity: .6; }
.hint { display: block; margin-top: 8px; font-size: 12.5px; color: var(--muted); }

.error {
  margin-top: 16px;
  padding: 11px 14px;
  border-radius: 10px;
  background: rgba(255, 90, 77, .12);
  border: 1px solid rgba(255, 90, 77, .35);
  color: #ff9d94;
  font-size: 13.5px;
}

.submit {
  width: 100%;
  margin-top: 20px;
  padding: 16px 24px;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  font-size: 16px;
  font-weight: 900;
  color: var(--brand-ink);
  background: linear-gradient(100deg, var(--brand-2), var(--brand));
  box-shadow: var(--shadow-brand);
  transition: transform .18s ease, filter .18s ease;
}
.submit:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.06); }
.submit:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }

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

.files { margin-top: 24px; display: grid; gap: 10px; }
.download {
  display: block;
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
/* 使用手冊是附帶檔案，樣式退一階，別跟安裝檔搶主要動作 */
.download.secondary {
  padding: 14px 24px;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: none;
}
.download.secondary:hover { border-color: var(--brand); color: var(--brand-2); }

.note { margin-top: 18px; font-size: 12.5px; color: #7c88a3; }
</style>
