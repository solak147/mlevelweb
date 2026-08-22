<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createEcpayOrder, submitEcpayForm } from '../lib/ecpay'

const emit = defineEmits(['close'])

const PRICE = 399

const email = ref('')
const agreed = ref(false)
const submitting = ref(false)
const error = ref('')

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim()))
const canSubmit = computed(() => emailValid.value && agreed.value && !submitting.value)

const onKey = (e) => {
  if (e.key === 'Escape' && !submitting.value) emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})

const pay = async () => {
  if (!canSubmit.value) {
    error.value = emailValid.value ? '請先勾選同意使用條款。' : '請填寫正確的 Email。'
    return
  }

  submitting.value = true
  error.value = ''

  try {
    const order = await createEcpayOrder({
      email: email.value.trim(),
      amount: PRICE,
      // 綠界付款完成後導回這個網址（後端會驗證網域）
      redirectBaseUrl: window.location.origin
    })

    // 導向綠界前先留一份訂單資訊，萬一回跳網址遺失參數還能救回來
    try {
      sessionStorage.setItem(
        'mlevel:lastOrder',
        JSON.stringify({ orderId: order.merchantTradeNo, token: order.accessToken })
      )
    } catch {
      // sessionStorage 不可用（無痕模式等）時忽略即可
    }

    submitEcpayForm(order.action, order.params)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '付款程序啟動失敗，請稍後再試。'
    submitting.value = false
  }
}
</script>

<template>
  <div class="mask" @click.self="!submitting && emit('close')">
    <div class="modal card" role="dialog" aria-modal="true" aria-label="購買 MLevel 月訂閱">
      <button class="x" type="button" aria-label="關閉" :disabled="submitting" @click="emit('close')">×</button>

      <span class="eyebrow">Checkout</span>
      <h3>MLevel 月訂閱</h3>

      <div class="amount">
        <span>應付金額</span>
        <strong>NT${{ PRICE }}</strong>
      </div>

      <form class="form" @submit.prevent="pay">
        <label class="field">
          <span class="label">Email</span>
          <input
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="you@example.com"
            :disabled="submitting"
            required
          />
          <span class="hint">這個信箱只用於綁定授權與客服查詢，目前不會寄送任何信件。</span>
        </label>

        <label class="agree">
          <input v-model="agreed" type="checkbox" :disabled="submitting" />
          <span>我了解這是一次性購買，授權自付款起算 30 天，且數位商品開通後恕不退款。</span>
        </label>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <button class="pay" type="submit" :disabled="!canSubmit">
          {{ submitting ? '前往綠界付款頁…' : `前往付款 NT$${PRICE}` }}
        </button>
      </form>

      <div class="methods">
        <div class="m">💳 信用卡一次付清</div>
      </div>

      <p class="note">付款由綠界科技 ECPay 處理，本站不會接觸到你的卡號。</p>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
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

h3 { margin: 10px 0 20px; font-size: 24px; }

.amount {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 16px 18px;
  border-radius: 12px;
  background: rgba(255, 138, 31, .1);
  border: 1px solid rgba(255, 138, 31, .28);
  color: var(--muted);
  font-size: 14px;
}
.amount strong { font-size: 28px; font-weight: 900; color: var(--brand-2); }

.form { margin-top: 22px; }

.field { display: block; }
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

.agree {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
  cursor: pointer;
}
.agree input { margin-top: 3px; accent-color: var(--brand); flex: none; }

.error {
  margin-top: 16px;
  padding: 11px 14px;
  border-radius: 10px;
  background: rgba(255, 90, 77, .12);
  border: 1px solid rgba(255, 90, 77, .35);
  color: #ff9d94;
  font-size: 13.5px;
}

.pay {
  width: 100%;
  margin-top: 20px;
  padding: 17px 24px;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: .02em;
  color: var(--brand-ink);
  background: linear-gradient(100deg, var(--brand-2), var(--brand));
  box-shadow: var(--shadow-brand);
  transition: transform .18s ease, filter .18s ease;
}
.pay:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.06); }
.pay:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }

.methods { display: grid; gap: 10px; margin-top: 18px; }
.m {
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  font-size: 14.5px;
  font-weight: 500;
}

.note { margin-top: 16px; font-size: 12.5px; color: #7c88a3; }
</style>
