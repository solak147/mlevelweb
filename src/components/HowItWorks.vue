<script setup>
const steps = [
  { n: '01', title: '購買並取得授權', desc: '完成付款後，授權金鑰與下載連結會直接顯示在頁面上，請自行複製保存。' },
  { n: '02', title: '解壓縮就能跑', desc: '免安裝、不用裝 Python。整個資料夾解開，以管理員身分執行 mlevel.exe（會跳一次 UAC 確認）。' },
  { n: '03', title: '選圖、測試比對', desc: '填遊戲視窗標題，加入人物圖（建議用姓名條）與怪物圖，按「測試比對」看分數對不對，順手調門檻。' },
  { n: '04', title: '按下開始打怪', desc: '要走位就先用 F8 錄一條路線。停止方式有三種：按「停止」、把滑鼠移到螢幕左上角，或等最長執行秒數到。' }
]
</script>

<template>
  <section id="how" class="section how">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">How it works</span>
        <h2>四個步驟就能開跑</h2>
        <p>從購買到開始掛機打怪只要四步，不需要任何程式基礎；遊戲請用視窗模式、Windows 顯示縮放固定 100%。</p>
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
