<script setup lang="ts">
import { computed, ref } from 'vue';
import { withBase } from 'vitepress';
import type { Journey } from './page-journeys';

const props = defineProps<{ journey: Journey }>();
const selected = ref(0);
const stage = computed(() => props.journey.stages[selected.value]);
</script>

<template>
  <section class="page-journey" aria-label="Understand this page">
    <div class="page-journey__intro">
      <span>START WITH THE BIG PICTURE</span><strong>{{ journey.goal }}</strong>
      <p>For {{ journey.audience.toLowerCase() }}</p>
    </div>
    <div class="page-journey__steps" role="group" aria-label="Explore the three steps">
      <button
        v-for="(item, index) in journey.stages"
        :key="item[0]"
        :aria-pressed="selected === index"
        @click="selected = index"
      >
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <template v-if="index === 0">
            <rect x="8" y="5" width="24" height="30" rx="3" />
            <path d="M14 14h12M14 21h12M14 28h7" />
          </template>
          <template v-else-if="index === 1">
            <rect x="3" y="13" width="12" height="14" rx="2" />
            <rect x="25" y="13" width="12" height="14" rx="2" />
            <path d="M15 20h10m-4-4 4 4-4 4" />
          </template>
          <template v-else>
            <circle cx="20" cy="20" r="15" />
            <path d="m12 20 5 5 11-11" />
          </template>
        </svg>
        <span>0{{ index + 1 }}</span
        ><strong>{{ item[0] }}</strong
        ><span v-if="index < 2" class="page-journey__arrow" aria-hidden="true">→</span>
      </button>
    </div>
    <div class="page-journey__detail" aria-live="polite">
      <span>STEP 0{{ selected + 1 }}</span>
      <p :key="selected">{{ stage[1] }}</p>
    </div>
    <details>
      <summary>What should I remember?</summary>
      <p>{{ journey.takeaway }}</p>
    </details>
    <a class="page-journey__glossary" :href="withBase('/guide/glossary')"
      >New to the terminology? See the words explained <span aria-hidden="true">→</span></a
    >
  </section>
</template>

<style scoped>
.page-journey {
  margin: 0 auto 2.5rem;
  max-width: 72rem;
  border: 1px solid var(--automate-border);
  border-radius: 0.4rem;
  overflow: hidden;
  background: var(--automate-surface);
  color: var(--automate-fg);
}
.page-journey__glossary {
  display: block;
  padding: 0.85rem 1.5rem;
  border-top: 1px solid var(--automate-border);
  color: var(--automate-fg-muted);
  font-size: 0.8rem;
  text-underline-offset: 0.2em;
}
.page-journey__glossary:hover {
  color: var(--automate-fg);
}
.page-journey__intro {
  padding: 1.5rem;
}
.page-journey__intro > span,
.page-journey__detail > span {
  font: 0.63rem var(--automate-font-mono);
  letter-spacing: 0.1em;
  color: var(--automate-fg-muted);
}
.page-journey__intro > strong {
  display: block;
  max-width: 42rem;
  margin: 0.65rem 0;
  font-size: clamp(1.2rem, 2.5vw, 1.7rem);
  line-height: 1.25;
  letter-spacing: -0.025em;
}
.page-journey__intro > p {
  margin: 0;
  color: var(--automate-fg-muted);
  font-size: 0.8rem;
}
.page-journey__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-block: 1px solid var(--automate-border);
}
.page-journey__steps button {
  position: relative;
  display: grid;
  justify-items: start;
  align-content: start;
  gap: 0.5rem;
  padding: 1.25rem;
  min-width: 0;
  border: 0;
  border-right: 1px solid var(--automate-border);
  background: var(--automate-surface-sunken);
  color: var(--automate-fg-muted);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--automate-duration-150);
}
.page-journey__steps button:last-child {
  border-right: 0;
}
.page-journey__steps button[aria-pressed='true'] {
  background: var(--automate-surface-raised);
  color: var(--automate-fg);
  box-shadow: inset 0 -2px var(--automate-accent);
}
.page-journey__steps svg {
  width: 2.5rem;
  height: 2.5rem;
  stroke: currentColor;
  stroke-width: 1.5;
}
.page-journey__steps button > span {
  font: 0.65rem var(--automate-font-mono);
}
.page-journey__steps button strong {
  font-size: 0.92rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.page-journey__steps .page-journey__arrow {
  position: absolute;
  right: 0.8rem;
  top: 1.5rem;
  font-size: 1.2rem;
}
.page-journey__detail {
  padding: 1.25rem 1.5rem;
  min-height: 7rem;
}
.page-journey__detail p {
  margin: 0.4rem 0 0;
  font-size: 1rem;
  line-height: 1.6;
  animation: journey-enter 150ms var(--automate-ease-out);
}
.page-journey > details {
  border-top: 1px solid var(--automate-border);
  padding: 1rem 1.5rem;
}
.page-journey summary {
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
}
.page-journey details p {
  margin: 0.7rem 0 0;
  font-size: 0.9rem;
  color: var(--automate-fg-muted);
  line-height: 1.6;
}
.page-journey button:focus-visible,
.page-journey summary:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: -3px;
}
@keyframes journey-enter {
  from {
    opacity: 0;
    transform: translateY(0.25rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 480px) {
  .page-journey__steps button {
    padding: 0.8rem;
  }
  .page-journey__steps button strong {
    font-size: 0.8rem;
  }
  .page-journey__steps .page-journey__arrow {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .page-journey__detail p {
    animation: none;
  }
}
</style>
