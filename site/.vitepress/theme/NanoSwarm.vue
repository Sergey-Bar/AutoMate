<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const root = ref<HTMLElement | null>(null);
const paused = ref(false);
const visible = ref(false);
const hidden = ref(false);
let observer: IntersectionObserver | undefined;
// Deterministic positions keep server and client renders identical.
// Two streams frame the content; the central reading area stays clear.
const bots = Array.from({ length: 120 }, (_, i) => {
  const lane = i % 2;
  const progress = Math.floor(i / 2) / 60;
  const wave = Math.sin(progress * Math.PI * 5);
  return {
    left: `${lane === 0 ? 3 + wave * 3 + (i % 5) : 94 - wave * 3 - (i % 5)}%`,
    top: `${3 + progress * 91}%`,
    dx: `${(lane === 0 ? 1 : -1) * (14 + (i % 7) * 7)}px`,
    dy: `${-35 - (i % 9) * 9}px`,
    delay: `${-i * 0.73}s`,
    duration: `${12 + (i % 7) * 2}s`,
    size: `${i % 11 === 0 ? 5 : i % 3 === 0 ? 3 : 2}px`,
  };
});
function visibilityChanged() {
  hidden.value = document.hidden;
}
onMounted(() => {
  visibilityChanged();
  document.addEventListener('visibilitychange', visibilityChanged);
  observer = new IntersectionObserver(([entry]) => {
    visible.value = !!entry?.isIntersecting;
  });
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>

<template>
  <div ref="root" class="nano" :class="{ 'nano--paused': paused || !visible || hidden }">
    <div class="nano__field" aria-hidden="true">
      <span
        v-for="(bot, index) in bots"
        :key="index"
        class="nano__bot"
        :class="{ 'nano__bot--frame': index % 11 === 0 }"
        :style="{
          left: bot.left,
          top: bot.top,
          width: bot.size,
          height: bot.size,
          '--dx': bot.dx,
          '--dy': bot.dy,
          animationDelay: bot.delay,
          animationDuration: bot.duration,
        }"
      />
      <svg class="nano__paths" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <path d="M30 0 C180 180 -60 270 70 470 S160 740 30 1000" />
        <path d="M970 0 C820 180 1060 270 930 470 S840 740 970 1000" />
        <path class="nano__path-secondary" d="M65 0 C-30 230 180 350 40 620 S130 850 65 1000" />
        <path class="nano__path-secondary" d="M935 0 C1030 230 820 350 960 620 S870 850 935 1000" />
      </svg>
    </div>
    <button class="nano__control" type="button" :aria-pressed="paused" @click="paused = !paused">
      <span aria-hidden="true">{{ paused ? '▷' : 'Ⅱ' }}</span>
      {{ paused ? 'Play ambient motion' : 'Pause ambient motion' }}
    </button>
  </div>
</template>

<style scoped>
.nano {
  position: absolute;
  inset: 0 -3%;
  pointer-events: none;
  color: var(--automate-fg);
  z-index: 0;
}
.nano__field {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.nano__bot {
  position: absolute;
  background: currentColor;
  opacity: 0.3;
  animation: nano-drift 18s ease-in-out infinite;
}
.nano__bot--frame {
  background: transparent;
  border: 1px solid currentColor;
}
.nano__paths {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-width: 0.5;
  opacity: 0.1;
}
.nano__paths path {
  vector-effect: non-scaling-stroke;
}
.nano__path-secondary {
  stroke-dasharray: 2 12;
}
.nano__control {
  position: absolute;
  bottom: 0.2rem;
  right: 3%;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 36px;
  padding: 0.4rem 0.6rem;
  color: var(--automate-fg-muted);
  background: var(--automate-surface-sunken);
  border: 1px solid var(--automate-border);
  border-radius: 4px;
  font: 0.6rem var(--automate-font-mono);
  cursor: pointer;
}
.nano__control:hover {
  color: var(--automate-fg);
}
.nano__control:focus-visible {
  outline: 2px solid var(--automate-fg);
  outline-offset: 4px;
}
.nano--paused .nano__bot {
  animation-play-state: paused;
}
@keyframes nano-drift {
  0%,
  100% {
    transform: translate(0, 0) rotate(0deg);
    opacity: 0.18;
  }
  30% {
    transform: translate(var(--dx), var(--dy)) rotate(90deg);
    opacity: 0.65;
  }
  65% {
    transform: translate(0, var(--dy)) rotate(180deg);
    opacity: 0.28;
  }
  85% {
    transform: translate(var(--dx), 12px) rotate(270deg);
    opacity: 0.45;
  }
}
@media (max-width: 640px) {
  .nano {
    inset-inline: -5%;
  }
  .nano__bot:nth-child(2n + 1) {
    display: none;
  }
  .nano__field {
    opacity: 0.55;
  }
  .nano__control {
    right: 5%;
    font-size: 0.55rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .nano__bot {
    animation: none;
    opacity: 0.2;
  }
  .nano__control {
    display: none;
  }
}
</style>
