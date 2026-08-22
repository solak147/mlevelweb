<script setup>
import { ref } from 'vue'
import SiteHeader from './components/SiteHeader.vue'
import HeroSection from './components/HeroSection.vue'
import FeatureGrid from './components/FeatureGrid.vue'
import HowItWorks from './components/HowItWorks.vue'
import FaqSection from './components/FaqSection.vue'
import SiteFooter from './components/SiteFooter.vue'
import CheckoutModal from './components/CheckoutModal.vue'
import LicenseResult from './components/LicenseResult.vue'
import LicenseLookup from './components/LicenseLookup.vue'

const checkoutOpen = ref(false)
const lookupOpen = ref(false)

// 綠界付款後會導回 /?orderId=…&status=…&token=…（見 functions/index.js 的 /result）
const readPaymentReturn = () => {
  const params = new URLSearchParams(window.location.search)
  const orderId = params.get('orderId') || ''
  if (!orderId) return null

  let token = params.get('token') || ''
  if (!token) {
    // 回跳網址若被截掉 token（例如綠界的 ClientBackURL），改用結帳前存下的那一份
    try {
      const saved = JSON.parse(sessionStorage.getItem('mlevel:lastOrder') || '{}')
      if (saved.orderId === orderId) token = saved.token || ''
    } catch {
      // 忽略解析失敗
    }
  }
  if (!token) return null

  return { orderId, token, status: params.get('status') || 'success' }
}

const paymentReturn = ref(readPaymentReturn())

const closeResult = () => {
  paymentReturn.value = null
  try {
    sessionStorage.removeItem('mlevel:lastOrder')
  } catch {
    // 忽略
  }
  // 清掉網址上的付款參數，避免重新整理又跳出結果視窗
  window.history.replaceState({}, '', window.location.pathname)
}
</script>

<template>
  <SiteHeader @lookup="lookupOpen = true" />
  <main>
    <HeroSection @buy="checkoutOpen = true" />
    <FeatureGrid />
    <HowItWorks />
    <FaqSection />
  </main>
  <SiteFooter @lookup="lookupOpen = true" />
  <CheckoutModal v-if="checkoutOpen" @close="checkoutOpen = false" />
  <LicenseLookup v-if="lookupOpen" @close="lookupOpen = false" />
  <LicenseResult
    v-if="paymentReturn"
    :order-id="paymentReturn.orderId"
    :token="paymentReturn.token"
    :status="paymentReturn.status"
    @close="closeResult"
  />
</template>
