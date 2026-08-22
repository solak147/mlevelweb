<script setup>
const features = [
  { icon: '⚔️', title: '圖像辨識打怪', desc: '用你截的人物圖與怪物圖比對畫面，怪進入攻擊範圍才出手。不讀寫遊戲記憶體、不注入程式碼。' },
  { icon: '🔮', title: '沒魔力自動改普攻', desc: '監看魔力條上一點的顏色，魔力見底就改按普通攻擊、換成較近的攻擊範圍，補滿再切回技能。' },
  { icon: '🧪', title: '自動補血補魔', desc: '在血條、魔條上各點一個門檻位置，掉到門檻以下自動按喝水鍵。兩者的按鍵與冷卻分開設定。' },
  { icon: '🗺️', title: '路線走位', desc: '按 F8 錄下小地圖路點，角色照路線循環跑。支援爬繩、跳躍、下跳穿平台與「原地打 N 秒」。' },
  { icon: '🧭', title: '路線綁定地圖', desc: '每條路線綁一張地圖，按下開始前會再確認畫面是同一張。站錯地圖直接擋下來，不會亂走。' },
  { icon: '💰', title: '自動撿物', desc: '定時按撿物鍵，可設定只在沒有交戰目標時才撿；打完一隻會在原地補撿。' },
  { icon: '🧱', title: '卡住自動脫困', desc: '角色與背景都不動超過設定秒數就跳躍反向；某個路點走不動也會記一行日誌後跳下一步。' },
  { icon: '🎯', title: '測試比對與日誌', desc: '不用真的跑起來，就能看人物與每種怪的比對分數；日誌會印出每一刀的距離、按鍵與每輪耗時。' }
]
</script>

<template>
  <section id="features" class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Features</span>
        <h2>看得到、走得到、打得到</h2>
        <p>偵測、攻擊、補給、走位分成四個頁簽，全部在同一個視窗裡設定完。</p>
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
