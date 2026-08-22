<script setup>
import { ref } from 'vue'

const faqs = [
  { q: '支援哪些作業系統？', a: '64 位元的 Windows 10 與 Windows 11。免安裝、不用另外裝 Python。目前不支援 macOS 與模擬器環境。' },
  { q: '有什麼環境要求？', a: '遊戲請用視窗模式（獨佔全螢幕會被拉伸，模板全部失準），Windows 顯示縮放固定 100%，並且不要讓其他視窗蓋住遊戲畫面 —— 程式讀的就是那塊畫面。遊戲以管理員身分執行時，本程式也要以管理員身分啟動，否則按鍵會被 Windows 擋掉。' },
  { q: '多少錢？怎麼付款？', a: '月授權 NT$399，透過綠界 ECPay 信用卡一次付清。付款完成後，授權金鑰與下載連結會直接顯示在頁面上。' },
  { q: '一組授權可以用多久？', a: '授權金鑰自付款起算 30 天有效。請自行保存好金鑰、不要外流 —— 金鑰就是授權本身。' },
  { q: '可以兩台電腦一起用嗎？', a: '同一把金鑰同一時間只能有一台電腦在跑。但不綁定裝置 —— 換電腦、重裝系統都不必解綁：關掉原本那一邊，或在新電腦啟動時選擇「在這台裝置使用」直接接手，被接手的那一邊會在幾分鐘內自動停止。程式當掉沒有正常關閉時，最多等 10 分鐘席位就會自動釋放（同一台電腦重開不必等）。另外程式需要保持連線續約，離線超過 30 分鐘會停止運作。' },
  { q: '付款頁面關掉了，要怎麼重新下載？', a: '用頁面上的「找回授權」，填入購買時的 email 與授權金鑰，即可重新取得有效期限與下載連結。' },
  { q: '需要自己截圖嗎？', a: '要。人物圖與怪物圖是你在自己的畫面上截的，模板比對沒有縮放不變性，所以換了顯示縮放要重截（換遊戲視窗大小則不用）。附的範例圖可以直接先試。' },
  { q: '會不會被偵測？', a: '程式只讀取遊戲畫面做圖像比對、用系統鍵盤事件送出按鍵，不修改遊戲記憶體、不注入程式碼。但任何第三方輔助工具都存在風險，且違反遊戲服務條款，使用前請自行評估，帳號後果由使用者自行承擔。' },
]

const open = ref(0)
const toggle = (i) => { open.value = open.value === i ? -1 : i }
</script>

<template>
  <section id="faq" class="section faq">
    <div class="container narrow">
      <div class="section-head">
        <span class="eyebrow">FAQ</span>
        <h2>常見問題</h2>
      </div>

      <div class="list">
        <div v-for="(f, i) in faqs" :key="f.q" class="card row" :class="{ open: open === i }">
          <button class="q" type="button" :aria-expanded="open === i" @click="toggle(i)">
            <span>{{ f.q }}</span>
            <span class="mark">{{ open === i ? '−' : '+' }}</span>
          </button>
          <p v-show="open === i" class="a">{{ f.a }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.faq { background: var(--bg-soft); border-top: 1px solid var(--line); }
.narrow { width: min(760px, 100% - 40px); }
.list { display: grid; gap: 12px; }
.row { overflow: hidden; }
.row.open { border-color: rgba(255, 138, 31, .4); }
.q {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px;
  background: none;
  border: 0;
  cursor: pointer;
  color: var(--text);
  font: 600 16px/1.5 inherit;
  text-align: left;
}
.mark { color: var(--brand); font-size: 22px; font-weight: 700; line-height: 1; }
.a {
  padding: 0 22px 20px;
  color: var(--muted);
  font-size: 14.5px;
}
</style>
