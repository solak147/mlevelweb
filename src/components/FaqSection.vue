<script setup>
import { ref } from 'vue'

const faqs = [
  { q: '支援哪些作業系統？', a: 'Windows 10 與 Windows 11（64 位元）。目前不支援 macOS 與模擬器環境。' },
  { q: '一組授權可以裝在幾台電腦？', a: '同時只能有一台電腦在線。可以在後台自行解綁後換到另一台裝置。' },
  { q: '會不會被偵測？', a: '程式採用畫面辨識與隨機化操作間隔，不修改遊戲記憶體、不注入程式碼。但任何第三方輔助工具都存在風險，且違反遊戲服務條款，使用前請自行評估，帳號後果由使用者自行承擔。' },
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
