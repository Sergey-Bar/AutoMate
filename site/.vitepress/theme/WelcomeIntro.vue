<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import LogoAssembly from './LogoAssembly.vue';

const emit = defineEmits<{ complete: [skipped: boolean] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const showing = ref(false);
const storageKey = 'automate-welcome-seen';
let timer: ReturnType<typeof setTimeout> | undefined;
let motion: MediaQueryList | undefined;
let disposed = false;
function finish(skipped = false) {
  if (!showing.value) return;
  clearTimeout(timer);
  showing.value = false;
  try {
    localStorage.setItem(storageKey, '1');
  } catch {
    /* Private browsing may disable storage. */
  }
  dialog.value?.close();
  emit('complete', skipped);
}
function assembled() {
  if (!showing.value) return;
  clearTimeout(timer);
  timer = setTimeout(() => finish(), 300);
}
function preferenceChanged() {
  if (motion?.matches && showing.value) finish(true);
}
function visibilityChanged() {
  if (document.hidden && showing.value) finish(true);
}
async function replay() {
  clearTimeout(timer);
  showing.value = true;
  if (motion?.matches) {
    finish(true);
    return;
  }
  showing.value = true;
  await nextTick();
  if (disposed) return;
  dialog.value?.showModal();
  // Fallback only: normal dismissal follows the renderer's completion event.
  timer = setTimeout(() => finish(), 6500);
}
defineExpose({ replay });
onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener('change', preferenceChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  try {
    if (localStorage.getItem(storageKey) === '1') {
      emit('complete', false);
      return;
    }
  } catch {
    /* Continue without persistence. */
  }
  void replay();
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
  motion?.removeEventListener('change', preferenceChanged);
  document.removeEventListener('visibilitychange', visibilityChanged);
  dialog.value?.close();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="welcome"
    aria-label="Welcome to Automate"
    @cancel.prevent="finish(true)"
  >
    <div class="welcome__center">
      <p class="welcome__eyebrow">CLARITY TAKES SHAPE</p>
      <LogoAssembly v-if="showing" @complete="assembled" />
      <p class="welcome__caption">Every signal. Coming together.</p>
    </div>
    <button class="welcome__skip" type="button" autofocus @click="finish(true)">
      Skip intro →
    </button>
  </dialog>
</template>

<style scoped>
.welcome {
  position: fixed;
  inset: 0;
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: none;
  margin: 0;
  padding: 2rem;
  border: 0;
  background: var(--automate-surface-sunken);
  color: var(--automate-fg);
  overflow: hidden;
}
.welcome[open] {
  display: grid;
  place-items: center;
}
.welcome::backdrop {
  background: var(--automate-surface-sunken);
}
.welcome__center {
  width: min(84vw, 52rem);
  text-align: center;
}
.welcome__logo {
  font-family: var(--automate-font-sans);
  font-size: clamp(2.5rem, 9vw, 7rem);
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.12em;
}
.welcome__eyebrow,
.welcome__caption {
  font: 0.65rem var(--automate-font-mono);
  letter-spacing: 0.18em;
  color: var(--automate-fg-muted);
}
.welcome__eyebrow {
  margin-bottom: 2rem;
}
.welcome__caption {
  margin-top: 2rem;
}
.welcome__skip {
  position: absolute;
  right: 2rem;
  bottom: 2rem;
  padding: 0.75rem;
  cursor: pointer;
  font: 0.7rem var(--automate-font-mono);
}
.welcome__skip:focus-visible {
  outline: 2px solid var(--automate-fg);
  outline-offset: 4px;
}
</style>
