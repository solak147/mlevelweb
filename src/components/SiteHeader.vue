<script setup>
const emit = defineEmits(['lookup'])
</script>

<template>
  <header class="header">
    <div class="container bar">
      <a class="brand" href="#top">
        <span class="leaf">🍁</span>
        <span class="name">MLevel</span>
      </a>
      <nav class="nav">
        <a href="#features">功能</a>
        <a href="#how">使用方式</a>
        <a href="#faq">常見問題</a>
        <button type="button" @click="emit('lookup')">找回授權</button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(11, 14, 20, .78);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 68px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  font-weight: 900;
  font-size: 20px;
  letter-spacing: .02em;
}
.leaf { font-size: 22px; }
.name {
  background: linear-gradient(100deg, var(--brand-2), var(--brand));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.nav {
  display: flex;
  gap: 28px;
  font-size: 15px;
  color: var(--muted);
}
.nav a {
  text-decoration: none;
  transition: color .15s ease;
}
.nav a:hover { color: var(--text); }
.nav button {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: color .15s ease;
}
.nav button:hover { color: var(--text); }

@media (max-width: 720px) {
  .nav { display: none; }
}
</style>
