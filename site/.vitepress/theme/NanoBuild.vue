<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ASSEMBLY_END, paintSwarm, type SwarmPalette } from './nano-field';

const props = withDefaults(
  defineProps<{ delay?: number; disabled?: boolean; active?: boolean }>(),
  {
    delay: 0,
    disabled: false,
    active: true,
  },
);
const emit = defineEmits<{ complete: [] }>();
const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const state = ref('waiting');
let frame = 0;
let resize: ResizeObserver | undefined;
let viewport: IntersectionObserver | undefined;
let theme: MutationObserver | undefined;
let motion: MediaQueryList | undefined;
let context: CanvasRenderingContext2D | null = null;
let bounds = { width: 0, height: 0, contentWidth: 0, inset: 0 };
let palette: SwarmPalette = { foreground: '', muted: '', edge: '', background: '' };
let started: number | undefined;
let inView = false;
let mounted = false;
let stride = 1;
let costlyFrames = 0;
function finish() {
  if (state.value === 'complete') return;
  state.value = 'complete';
  cancelAnimationFrame(frame);
  context?.clearRect(0, 0, bounds.width, bounds.height);
  resize?.disconnect();
  viewport?.disconnect();
  theme?.disconnect();
  emit('complete');
}
function readPalette() {
  if (!canvas.value) return;
  const style = getComputedStyle(canvas.value);
  palette = {
    foreground: style.getPropertyValue('--automate-fg').trim(),
    muted: style.getPropertyValue('--automate-fg-muted').trim(),
    edge: style.getPropertyValue('--automate-border-strong').trim(),
    background: style.getPropertyValue('--automate-surface-sunken').trim(),
  };
}
function draw(now: number) {
  if (!context || state.value === 'complete') return;
  started ??= now;
  const elapsed = (now - started) / 1000 - props.delay;
  if (elapsed >= ASSEMBLY_END) {
    finish();
    return;
  }
  const before = performance.now();
  paintSwarm(context, bounds, palette, elapsed, stride);
  // Preserve flow on slower devices by reducing density, never extending the entrance.
  if (performance.now() - before > 10) costlyFrames++;
  if (costlyFrames >= 8 && stride < 3) {
    stride++;
    costlyFrames = 0;
  }
  frame = requestAnimationFrame(draw);
}
function start() {
  if (!mounted || state.value !== 'waiting' || !props.active) return;
  if (props.disabled || motion?.matches || !context || document.hidden) {
    finish();
    return;
  }
  if (!inView || !bounds.width || !bounds.height) return;
  state.value = 'building';
  paintSwarm(context, bounds, palette, -1);
  frame = requestAnimationFrame(draw);
}
function preferenceChanged() {
  if (motion?.matches) finish();
}
function visibilityChanged() {
  if (document.hidden && state.value === 'building') finish();
}
watch(
  () => props.active,
  (active) => {
    if (active) start();
    else if (state.value === 'building') {
      cancelAnimationFrame(frame);
      context?.clearRect(0, 0, bounds.width, bounds.height);
      started = undefined;
      state.value = 'waiting';
    }
  },
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) finish();
  },
);
onMounted(() => {
  mounted = true;
  const element = canvas.value;
  if (!element || !root.value) {
    finish();
    return;
  }
  motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || props.disabled) {
    finish();
    return;
  }
  context = element.getContext('2d');
  if (!context) {
    finish();
    return;
  }
  motion.addEventListener('change', preferenceChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  theme = new MutationObserver(readPalette);
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
  resize = new ResizeObserver(() => {
    const rect = element.getBoundingClientRect();
    const content = root.value?.getBoundingClientRect();
    if (!content) return;
    bounds = {
      width: rect.width,
      height: rect.height,
      contentWidth: content.width,
      inset: content.left - rect.left,
    };
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    element.width = Math.round(bounds.width * ratio);
    element.height = Math.round(bounds.height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    readPalette();
    start();
  });
  resize.observe(element);
  viewport = new IntersectionObserver(
    ([entry]) => {
      inView = !!entry?.isIntersecting;
      if (!inView && state.value === 'building') finish();
      else start();
    },
    { threshold: 0.08 },
  );
  viewport.observe(root.value);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  resize?.disconnect();
  viewport?.disconnect();
  theme?.disconnect();
  motion?.removeEventListener('change', preferenceChanged);
  document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>

<template>
  <div ref="root" class="nano-build" :data-assembly-state="state" @focusin="finish">
    <slot />
    <canvas ref="canvas" class="nano-build__grid" aria-hidden="true" />
  </div>
</template>

<style scoped>
.nano-build {
  position: relative;
  isolation: isolate;
}
.nano-build__grid {
  position: absolute;
  top: 0;
  left: calc(50% - 50vw);
  width: 100vw;
  height: 100%;
  pointer-events: none;
  z-index: 2;
}
.nano-build[data-assembly-state='complete'] .nano-build__grid {
  visibility: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .nano-build__grid {
    display: none;
  }
}
</style>
