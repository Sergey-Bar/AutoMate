<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useData, withBase } from 'vitepress';
import { translations } from '../locales';
const { lang, page } = useData();
const dialog = ref<HTMLDialogElement | null>(null);
const current = computed(() => translations.find((item) => item.lang === lang.value));
const hebrew = computed(() => lang.value === 'he');
watch(
  () => page.value.relativePath,
  () => dialog.value?.close(),
);
</script>
<template>
  <button
    class="language-trigger"
    type="button"
    :aria-label="hebrew ? 'בחירת שפה' : 'Select language'"
    :title="hebrew ? 'בחירת שפה' : 'Select language'"
    aria-haspopup="dialog"
    @click="dialog?.showModal()"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </svg>
  </button>
  <dialog
    ref="dialog"
    class="language-dialog"
    aria-labelledby="language-title"
    :dir="['he', 'ar'].includes(lang) ? 'rtl' : 'ltr'"
  >
    <div class="language-dialog__header">
      <div>
        <h2 id="language-title">{{ hebrew ? 'בחרו את השפה שלכם' : 'Choose your language' }}</h2>
      </div>
      <button
        type="button"
        class="language-close"
        :aria-label="hebrew ? 'סגירה' : 'Close language menu'"
        @click="dialog?.close()"
      >
        ×
      </button>
    </div>
    <nav class="language-grid" :aria-label="hebrew ? 'שפות' : 'Languages'">
      <a
        v-for="item in translations"
        :key="item.code"
        :lang="item.lang"
        :href="withBase(item.code === 'en' ? '/' : `/${item.code}/`)"
        :aria-current="item.lang === lang ? 'page' : undefined"
        @click="dialog?.close()"
      >
        <bdi>{{ item.label }}</bdi
        ><span v-if="item.lang === lang" aria-hidden="true">✓</span>
      </a>
    </nav>
  </dialog>
</template>
<style scoped>
.language-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  padding: 0.5rem;
  margin-inline-start: 0.5rem;
  border-radius: 6px;
  font-size: 0.75rem;
  cursor: pointer;
}
.language-trigger svg {
  width: 20px;
  height: 20px;
}
.language-trigger:hover {
  background: var(--automate-surface-muted);
}
.language-dialog {
  width: min(68rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  margin: auto;
  padding: clamp(1.5rem, 4vw, 4rem);
  border: 1px solid var(--automate-border);
  border-radius: 12px;
  color: var(--automate-fg);
  background: var(--automate-surface);
  overflow: auto;
  overscroll-behavior: contain;
}
.language-dialog::backdrop {
  background: var(--automate-surface-sunken);
  opacity: 0.88;
}
.language-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 2.5rem;
}
.language-dialog__header p {
  font: 0.65rem var(--automate-font-mono);
  letter-spacing: 0.2em;
  color: var(--automate-fg-muted);
  margin-bottom: 0.75rem;
}
h2 {
  font-size: clamp(1.6rem, 3vw, 2.5rem);
  font-weight: 650;
  line-height: 1.2;
}
.language-close {
  width: 44px;
  height: 44px;
  font-size: 2rem;
  border-radius: 50%;
  cursor: pointer;
}
.language-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6rem 1.5rem;
}
.language-grid a {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.8rem;
  min-height: 48px;
  border-radius: 5px;
  border: 1px solid transparent;
  font-size: 1rem;
  line-height: 1.6;
  align-items: center;
  text-align: start;
}
.language-grid bdi {
  min-width: 0;
  overflow-wrap: anywhere;
}
.language-grid a:hover,
.language-close:hover {
  background: var(--automate-surface-muted);
}
.language-grid a[aria-current] {
  border-color: var(--automate-border-strong);
  background: var(--automate-surface-muted);
}
a:focus-visible,
button:focus-visible {
  outline: 2px solid var(--automate-fg);
  outline-offset: 3px;
}
@media (max-width: 900px) {
  .language-trigger > span {
    display: none;
  }
  .language-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .language-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
}
@media (max-width: 360px) {
  .language-grid {
    grid-template-columns: 1fr;
  }
}
</style>
