<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import runsPreview from '../../../docs/assets/runs.png';

const props = withDefaults(defineProps<{ autoplayReady?: boolean }>(), { autoplayReady: true });
const inView = ref(false);

const steps = [
  { label: 'Open a run', detail: 'Start with the full run history.', x: 6, y: 53 },
  { label: 'Inspect the outcome', detail: 'Find the failure that needs attention.', x: 30, y: 66 },
  {
    label: 'Check release readiness',
    detail: 'See whether every required signal exists.',
    x: 80,
    y: 47,
  },
  { label: 'Make a decision', detail: 'Move forward with the complete context.', x: 80, y: 61 },
] as const;

const active = ref(0);
const playing = ref(false);
const started = ref(false);
const reducedMotion = ref(false);
const demo = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
let observer: IntersectionObserver | undefined;
let motionQuery: MediaQueryList | undefined;

function stop(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  playing.value = false;
}

function advance(): void {
  if (active.value >= steps.length - 1) {
    stop();
    return;
  }
  active.value += 1;
}

function play(): void {
  if (reducedMotion.value) {
    active.value = active.value >= steps.length - 1 ? 0 : active.value + 1;
    return;
  }
  if (active.value >= steps.length - 1) active.value = 0;
  if (playing.value) return;
  playing.value = true;
  timer = setInterval(advance, 1800);
}

function toggle(): void {
  if (playing.value) stop();
  else play();
}

function onVisibility(): void {
  if (document.hidden) stop();
}

function onMotionChange(event: MediaQueryListEvent): void {
  reducedMotion.value = event.matches;
  if (event.matches) stop();
}

watch(
  () => props.autoplayReady,
  (ready) => {
    if (!ready) {
      stop();
      return;
    }
    if (inView.value && !started.value) {
      started.value = true;
      play();
    }
  },
);

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionQuery.matches;
  motionQuery.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', onVisibility);
  observer = new IntersectionObserver(
    (entries) => {
      inView.value = !!entries[0]?.isIntersecting;
      if (inView.value && props.autoplayReady && !started.value) {
        started.value = true;
        play();
      } else if (!entries[0]?.isIntersecting) {
        stop();
      }
    },
    { threshold: 0.45 },
  );
  if (demo.value) observer.observe(demo.value);
});

onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
  motionQuery?.removeEventListener('change', onMotionChange);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div ref="demo" class="product-frame" aria-label="Automate product preview">
    <div class="product-frame__caption">
      <span>01 / THE PRODUCT</span><span>RUNS OVERVIEW</span>
    </div>
    <div class="demo__screen">
      <img
        :src="runsPreview"
        alt="Automate runs dashboard showing passed and failed test runs, release readiness and recent executions"
      />
      <div
        class="demo__target"
        :style="{ left: `${steps[active].x}%`, top: `${steps[active].y}%` }"
        aria-hidden="true"
      >
        <span></span>
      </div>
      <div
        class="demo__cursor"
        :style="{ left: `${steps[active].x}%`, top: `${steps[active].y}%` }"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 28" fill="none">
          <path
            d="M2 2v20l5.8-5.5 4 8 3.2-1.6-4-8H20L2 2Z"
            fill="currentColor"
            stroke="var(--automate-surface)"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <div class="demo__caption" aria-hidden="true">
        <span>0{{ active + 1 }} / 0{{ steps.length }}</span>
        <strong>{{ steps[active].label }}</strong>
        <small>{{ steps[active].detail }}</small>
      </div>
    </div>
    <div class="demo__controls">
      <div class="demo__progress" aria-hidden="true">
        <span
          v-for="(_, index) in steps"
          :key="index"
          :class="{ 'is-active': index <= active }"
        ></span>
      </div>
      <button
        type="button"
        :aria-label="
          reducedMotion
            ? 'Show next demo step'
            : playing
              ? 'Pause product demo'
              : 'Play product demo'
        "
        @click="toggle"
      >
        {{
          reducedMotion
            ? 'NEXT STEP'
            : playing
              ? 'PAUSE'
              : active === steps.length - 1
                ? 'REPLAY'
                : 'PLAY'
        }}
        <span aria-hidden="true">{{ playing ? 'Ⅱ' : '↻' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.product-frame {
  overflow: hidden;
  border: 1px solid var(--automate-border);
  border-radius: 0.3rem;
  background: var(--automate-surface);
  box-shadow: 0 1.5rem 4rem var(--automate-border);
}
.product-frame__caption,
.demo__controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 1rem;
  background: var(--automate-surface-raised);
  font-family: var(--automate-font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--automate-fg-muted);
}
.product-frame__caption {
  border-bottom: 1px solid var(--automate-border);
}
.demo__screen {
  position: relative;
  overflow: hidden;
}
.demo__screen img {
  display: block;
  width: 100%;
  height: auto;
}
.demo__cursor,
.demo__target {
  position: absolute;
  pointer-events: none;
  transition:
    left 0.8s var(--automate-ease-out),
    top 0.8s var(--automate-ease-out);
}
.demo__cursor {
  width: clamp(1rem, 2vw, 1.5rem);
  color: var(--automate-fg);
  filter: drop-shadow(0 1px 2px var(--automate-surface));
}
.demo__cursor svg {
  display: block;
  width: 100%;
}
.demo__target {
  width: 1.6rem;
  height: 1.6rem;
  margin: -0.65rem 0 0 -0.65rem;
  border: 1px solid var(--automate-accent);
  border-radius: 50%;
  opacity: 0.85;
}
.demo__target span {
  display: block;
  width: 100%;
  height: 100%;
  border: 1px solid var(--automate-accent);
  border-radius: 50%;
  animation: demo-click 1.8s ease-out infinite;
}
.demo__caption {
  position: absolute;
  left: 2.2%;
  bottom: 3%;
  display: grid;
  gap: 0.25rem;
  max-width: 55%;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--automate-border-strong);
  border-radius: 0.2rem;
  background: var(--automate-surface);
  box-shadow: 0 0.3rem 1.2rem var(--automate-border);
  color: var(--automate-fg);
}
.demo__caption span {
  font-family: var(--automate-font-mono);
  font-size: 0.58rem;
  color: var(--automate-fg-muted);
}
.demo__caption strong {
  font-size: clamp(0.65rem, 1vw, 0.85rem);
}
.demo__caption small {
  font-size: clamp(0.55rem, 0.85vw, 0.7rem);
  line-height: 1.3;
  color: var(--automate-fg-muted);
}
.demo__controls {
  min-height: 2.5rem;
  border-top: 1px solid var(--automate-border);
}
.demo__progress {
  display: flex;
  gap: 0.3rem;
  width: 50%;
}
.demo__progress span {
  height: 2px;
  flex: 1;
  background: var(--automate-border-strong);
  transition: background-color 0.15s;
}
.demo__progress .is-active {
  background: var(--automate-accent);
}
.demo__controls button {
  display: inline-flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.45rem 0;
  border: 0;
  background: none;
  color: var(--automate-fg);
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
}
.demo__controls button:hover {
  color: var(--automate-fg-muted);
}
.demo__controls button:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: 2px;
}
@keyframes demo-click {
  0%,
  45% {
    transform: scale(0.5);
    opacity: 0;
  }
  65% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}
@media (max-width: 48rem) {
  .demo__caption small {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .demo__target span {
    animation: none;
  }
  .demo__cursor,
  .demo__target {
    transition: none;
  }
}
</style>
