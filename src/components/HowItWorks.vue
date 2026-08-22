<script setup>
const steps = [
  { n: '01', title: '購買並取得授權', desc: '完成付款後，系統立即寄送授權金鑰與下載連結到你的信箱。' },
  { n: '02', title: '安裝並登入', desc: '下載主程式，輸入金鑰啟用。支援 Windows 10／11，安裝約 1 分鐘。' },
  { n: '03', title: '選擇職業模板', desc: '挑選對應職業的預設腳本，或自行調整技能循環、補水門檻與撿物清單。' },
  { n: '04', title: '按下開始，收工', desc: '設定掛機時數後就能離開，回來時查看報表看看賺了多少。' }
]
</script>

<template>
  <section id="how" class="section how">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">How it works</span>
        <h2>四個步驟，五分鐘上手</h2>
        <p>不需要任何程式基礎，照著點就會。</p>
      </div>

      <ol class="steps">
        <li v-for="s in steps" :key="s.n" class="step">
          <span class="n">{{ s.n }}</span>
          <div>
            <h3>{{ s.title }}</h3>
            <p>{{ s.desc }}</p>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.how { background: var(--bg-soft); border-block: 1px solid var(--line); }
.steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}
.step {
  position: relative;
  padding: 26px 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.n {
  display: block;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: .16em;
  color: var(--brand);
  margin-bottom: 12px;
}
.step h3 { font-size: 17px; margin-bottom: 8px; }
.step p { color: var(--muted); font-size: 14.5px; }
</style>
