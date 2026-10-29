<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
const emit = defineEmits<{ complete: [] }>();
const canvas = ref<HTMLCanvasElement | null>(null);
const resolved = ref(0);
const viewport = ref({ width: 1, height: 1, size: 1 });
let frame = 0;
let cancelled = false;
onBeforeUnmount(() => {
  cancelled = true;
  cancelAnimationFrame(frame);
});
onMounted(async () => {
  await document.fonts.ready;
  if (cancelled || !canvas.value) return;
  const el = canvas.value;
  const ctx = el.getContext('2d');
  if (!ctx) {
    emit('complete');
    return;
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  el.width = width * ratio;
  el.height = height * ratio;
  ctx.scale(ratio, ratio);
  const style = getComputedStyle(el);
  const color = style.getPropertyValue('--automate-fg').trim();
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const ink = mask.getContext('2d', { willReadFrequently: true });
  if (!ink) {
    emit('complete');
    return;
  }
  const size = Math.min(112, width * 0.105);
  viewport.value = { width, height, size };
  ink.font = `700 ${size}px ${style.getPropertyValue('--automate-font-sans')}`;
  ink.textBaseline = 'middle';
  ink.textAlign = 'center';
  ink.fillText('AUTOMATE', width / 2, height / 2);
  // Render the finished wordmark as real antialiased glyphs, using the exact
  // font and origin sampled by the particles rather than retaining their grid.
  ctx.font = ink.font;
  ctx.textBaseline = ink.textBaseline;
  ctx.textAlign = ink.textAlign;
  const pixels = ink.getImageData(0, 0, width, height).data;
  const points: {
    x: number;
    y: number;
    sx: number;
    sy: number;
    depth: number;
    delay: number;
    arc: number;
  }[] = [];
  const gap = width < 600 ? 1.5 : 2;
  for (let y = Math.max(0, height / 2 - size); y < Math.min(height, height / 2 + size); y += gap) {
    for (let x = 0; x < width; x += gap) {
      if ((pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] ?? 0) < 100) continue;
      const edge = Math.floor(Math.random() * 4);
      points.push({
        x,
        y,
        sx: edge === 0 ? -80 : edge === 1 ? width + 80 : Math.random() * width,
        sy: edge === 2 ? -80 : edge === 3 ? height + 80 : Math.random() * height,
        depth: 0.5 + Math.random() * 2,
        delay: Math.random() * 0.9 + (x / width) * 1.4,
        arc: (Math.random() - 0.5) * 240,
      });
    }
  }
  const assembledAt = points.reduce((latest, point) => Math.max(latest, point.delay + 2.1), 0);
  const dissolveDuration = 0.35;
  const finishedAt = assembledAt + dissolveDuration + 1.2;
  let start: number | undefined;
  function draw(now: number) {
    if (cancelled || !ctx) return;
    start ??= now;
    const time = (now - start) / 1000;
    const resolve = Math.max(0, Math.min(1, (time - assembledAt) / dissolveDuration));
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    for (const point of points) {
      const t = Math.max(0, Math.min(1, (time - point.delay) / 2.1));
      if (!t) continue;
      const ease = 1 - Math.pow(1 - t, 3);
      const curve = Math.sin(t * Math.PI) * point.arc;
      const x = point.sx + (point.x - point.sx) * ease + curve * 0.4;
      const y = point.sy + (point.y - point.sy) * ease + curve;
      const dot = gap * (t === 1 ? 1.05 : 0.4 + point.depth * (1 - t));
      ctx.globalAlpha = Math.min(1, t * 5) * (0.4 + ease * 0.6) * (1 - resolve);
      ctx.fillRect(x, y, dot, dot);
    }
    resolved.value = resolve;
    ctx.globalAlpha = 1;
    if (time < finishedAt) frame = requestAnimationFrame(draw);
    else emit('complete');
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    emit('complete');
    return;
  }
  frame = requestAnimationFrame(draw);
});
</script>
<template>
  <div class="logo-assembly" role="img" aria-label="Automate">
    <canvas ref="canvas" aria-hidden="true" />
    <svg
      class="logo-assembly__final"
      :viewBox="`0 0 ${viewport.width} ${viewport.height}`"
      :style="{ opacity: resolved }"
      aria-hidden="true"
    >
      <text
        :x="viewport.width / 2"
        :y="viewport.height / 2"
        :font-size="viewport.size"
        text-anchor="middle"
        dominant-baseline="central"
      >
        AUTOMATE
      </text>
    </svg>
  </div>
</template>
<style scoped>
.logo-assembly {
  height: clamp(4rem, 14vw, 10rem);
}
.logo-assembly canvas,
.logo-assembly__final {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}
.logo-assembly__final {
  fill: currentColor;
  font-family: var(--automate-font-sans);
  font-weight: 700;
}
</style>
