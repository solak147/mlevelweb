<script setup>
const features = [
  { icon: '⚔️', title: '自動打怪', desc: '自訂技能循環與攻擊範圍，怪物進場即自動施放，支援上下平台移動與繩索攀爬。' },
  { icon: '🧪', title: '自動補血補魔', desc: '偵測 HP／MP 百分比自動吃水，可分別設定門檻與冷卻，低血量自動回城。' },
  { icon: '💰', title: '自動撿物', desc: '依道具名稱與稀有度過濾，只撿你要的；背包滿自動整理或回商店販售。' },
  { icon: '🔁', title: '自動換頻／換圖', desc: '偵測到其他玩家或地圖清空時自動換頻，避開卡點與搶怪。' },
  { icon: '🛡️', title: '反閒置偵測', desc: '隨機化操作間隔與滑鼠軌跡，模擬真人節奏，避免固定行為模式。' },
  { icon: '📊', title: '掛機報表', desc: '記錄經驗值成長、楓幣收入與掉落統計，隨時查看這段時間練了多少。' },
  { icon: '🎯', title: '職業模板', desc: '內建 12 種以上職業預設腳本，載入即用，也能自己編排技能順序。' },
  { icon: '🖥️', title: '多開支援', desc: '單機最多同時控制 4 個視窗，各自獨立設定，互不干擾。' }
]
</script>

<template>
  <section id="features" class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Features</span>
        <h2>你需要的功能，全都內建</h2>
        <p>不用東拼西湊一堆小工具，一套搞定整個掛機流程。</p>
      </div>

      <div class="grid">
        <article v-for="f in features" :key="f.title" class="card item">
          <div class="icon">{{ f.icon }}</div>
          <h3>{{ f.title }}</h3>
          <p>{{ f.desc }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 18px;
}
.item {
  padding: 26px 24px;
  transition: transform .18s ease, border-color .18s ease;
}
.item:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 138, 31, .45);
}
.icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  font-size: 22px;
  border-radius: 12px;
  background: rgba(255, 138, 31, .12);
  border: 1px solid rgba(255, 138, 31, .25);
}
.item h3 { margin: 16px 0 8px; font-size: 18px; }
.item p { color: var(--muted); font-size: 14.5px; }
</style>
