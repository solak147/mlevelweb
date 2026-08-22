<template>
  <footer class="footer">
    <div class="container">
      <div class="top">
        <div>
          <div class="brand">🍁 MLevel</div>
          <p class="tag">楓之谷 經典版 自動化輔助程式</p>
        </div>
        <nav class="links">
          <a href="#features">功能</a>
          <a href="#faq">常見問題</a>
          <a href="mailto:support@mlevel.example">聯絡我們</a>
        </nav>
      </div>

      <p class="disclaimer">
        免責聲明：本程式為第三方非官方工具，與 Nexon 及《楓之谷》官方無任何關聯。
        使用第三方輔助程式可能違反遊戲服務條款，並導致帳號受到處分，請自行評估風險並承擔後果。
      </p>

      <p class="copy">© 2026 MLevel. All rights reserved.</p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  padding: 52px 0 40px;
  border-top: 1px solid var(--line);
  background: var(--bg);
}
.top {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: space-between;
  align-items: flex-start;
}
.brand { font-weight: 900; font-size: 18px; }
.tag { color: var(--muted); font-size: 14px; margin-top: 4px; }
.links { display: flex; flex-wrap: wrap; gap: 22px; font-size: 14px; color: var(--muted); }
.links a { text-decoration: none; }
.links a:hover { color: var(--text); }

.disclaimer {
  margin-top: 32px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: #8592ad;
  font-size: 12.5px;
  line-height: 1.8;
}
.copy { margin-top: 20px; font-size: 12.5px; color: #6b7590; }
</style>
