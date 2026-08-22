<script setup>
defineEmits(['buy'])

const stats = [
  { value: '24h', label: '不間斷掛機' },
  { value: '12+', label: '職業腳本模板' },
  { value: '3,800+', label: '累積使用者' }
]
</script>

<template>
  <section id="top" class="hero">
    <div class="glow glow-a" />
    <div class="glow glow-b" />

    <div class="container inner">
      <span class="eyebrow">MapleStory Classic · 自動化輔助</span>

      <h1>
        讓角色自己練功，<br />
        你只要<span class="hl">收成果</span>。
      </h1>

      <p class="lede">
        MLevel 是專為「楓之谷 經典版」打造的圖像辨識輔助程式。自動打怪、自動補血補魔、
        自動撿物，還能錄一條路線讓角色照著跑。
      </p>

      <!-- 全站唯一的購買按鈕 -->
      <div class="cta">
        <button class="buy" type="button" @click="$emit('buy')">
          <span class="buy-main">立即購買</span>
          <span class="buy-price">NT$399 / 月</span>
        </button>
        <p class="cta-note">信用卡一次付清｜付款完成後立即取得授權金鑰</p>
      </div>

      <!-- <ul class="badges">
        <li>✔ 7 天不滿意退款</li>
        <li>✔ 免費版本更新</li>
        <li>✔ 隨時可取消訂閱</li>
      </ul> -->

      <!-- <div class="stats">
        <div v-for="s in stats" :key="s.label" class="stat">
          <strong>{{ s.value }}</strong>
          <span>{{ s.label }}</span>
        </div>
      </div> -->
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  padding: 92px 0 84px;
  background:
    radial-gradient(1200px 520px at 50% -10%, rgba(255, 138, 31, .16), transparent 62%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg-soft) 100%);
  border-bottom: 1px solid var(--line);
}
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  pointer-events: none;
}
.glow-a { width: 420px; height: 420px; top: -140px; left: -80px; background: rgba(255, 90, 77, .22); }
.glow-b { width: 460px; height: 460px; bottom: -220px; right: -100px; background: rgba(255, 194, 71, .14); }

.inner {
  position: relative;
  text-align: center;
  max-width: 760px;
}

h1 {
  margin-top: 18px;
  font-size: clamp(34px, 6.4vw, 62px);
}
.hl {
  background: linear-gradient(100deg, var(--brand-2), var(--leaf));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.lede {
  margin: 22px auto 0;
  max-width: 620px;
  color: var(--muted);
  font-size: 17px;
}

.cta { margin-top: 44px; }

.buy {
  display: inline-flex;
  align-items: baseline;
  gap: 14px;
  padding: 22px 52px;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  color: var(--brand-ink);
  background: linear-gradient(100deg, var(--brand-2), var(--brand));
  box-shadow: var(--shadow-brand);
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
  animation: pulse 2.8s ease-in-out infinite;
}
.buy:hover {
  transform: translateY(-3px);
  filter: brightness(1.06);
  box-shadow: 0 26px 60px -12px rgba(255, 138, 31, .7);
}
.buy:active { transform: translateY(0); }
.buy:focus-visible { outline: 3px solid var(--brand-2); outline-offset: 4px; }

.buy-main { font-size: 24px; font-weight: 900; letter-spacing: .04em; }
.buy-price { font-size: 17px; font-weight: 700; opacity: .82; }

@keyframes pulse {
  0%, 100% { box-shadow: var(--shadow-brand); }
  50% { box-shadow: 0 18px 62px -8px rgba(255, 138, 31, .78); }
}
@media (prefers-reduced-motion: reduce) {
  .buy { animation: none; }
}

.cta-note {
  margin-top: 16px;
  font-size: 13.5px;
  color: var(--muted);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 22px;
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  color: var(--ok);
}

.stats {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 52px;
}
.stat {
  flex: 1;
  max-width: 200px;
  padding: 18px 10px;
  background: rgba(255, 255, 255, .03);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.stat strong {
  display: block;
  font-size: 26px;
  font-weight: 900;
  color: var(--brand-2);
}
.stat span { font-size: 13px; color: var(--muted); }

@media (max-width: 560px) {
  .buy { width: 100%; flex-direction: column; align-items: center; gap: 4px; padding: 20px 24px; }
  .stats { flex-direction: column; align-items: stretch; }
  .stat { max-width: none; }
}
</style>
