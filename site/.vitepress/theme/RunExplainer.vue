<script setup lang="ts">
import { computed, ref } from 'vue';

const scenarios = [
  {
    label: 'Pass first time',
    outcome: 'Passed',
    tone: 'pass',
    attempts: ['Passed'],
    explanation: 'The test passed on its first attempt. There is no retry to investigate.',
  },
  {
    label: 'Pass on retry',
    outcome: 'Flaky',
    tone: 'flaky',
    attempts: ['Failed', 'Passed'],
    explanation:
      'The first attempt failed and the retry passed. Automate preserves both attempts and reports the test as flaky.',
  },
  {
    label: 'Fail again',
    outcome: 'Failed',
    tone: 'fail',
    attempts: ['Failed', 'Failed'],
    explanation: 'The final attempt failed. Retrying did not turn the test into a pass.',
  },
  {
    label: 'Missing result',
    outcome: 'Unknown',
    tone: 'unknown',
    attempts: ['No readable result'],
    explanation:
      'There is no readable outcome for this test. Missing evidence cannot establish that it passed.',
  },
] as const;
const selected = ref(1);
const scenario = computed(() => scenarios[selected.value]);
</script>

<template>
  <section class="run-lab" aria-label="Explore test retries">
    <div class="run-lab__intro">
      <span>TRY A SCENARIO</span>
      <h3>What if the retry passes?</h3>
      <p>Choose an example. Watch how the attempt history determines the test status.</p>
    </div>
    <div class="run-lab__choices" role="group" aria-label="Test scenarios">
      <button
        v-for="(item, index) in scenarios"
        :key="item.label"
        :aria-pressed="selected === index"
        @click="selected = index"
      >
        {{ item.label }}
      </button>
    </div>
    <div :key="selected" class="run-lab__canvas" aria-live="polite">
      <div class="run-lab__timeline">
        <template v-for="(attempt, index) in scenario.attempts" :key="index">
          <span v-if="index > 0" class="run-lab__arrow" aria-hidden="true">→</span>
          <div
            class="run-lab__attempt"
            :class="
              attempt === 'Passed'
                ? 'tone-pass'
                : attempt === 'Failed'
                  ? 'tone-fail'
                  : 'tone-unknown'
            "
          >
            <span class="run-lab__symbol" aria-hidden="true">{{
              attempt === 'Passed' ? '✓' : attempt === 'Failed' ? '×' : '?'
            }}</span>
            <small>ATTEMPT {{ index + 1 }}</small
            ><strong>{{ attempt }}</strong>
          </div>
        </template>
      </div>
      <div class="run-lab__verdict" :class="`tone-${scenario.tone}`">
        <small>REPORTED TEST STATUS</small><strong>{{ scenario.outcome }}</strong>
        <p>{{ scenario.explanation }}</p>
      </div>
    </div>
    <p class="run-lab__note">
      Illustrative test retries within one run. A job execution attempt is a separate concept.
    </p>
  </section>
</template>

<style scoped>
.run-lab {
  margin: 1.5rem 0 2rem;
  border: 1px solid var(--automate-border);
  border-radius: 0.35rem;
  overflow: hidden;
  background: var(--automate-surface);
}
.run-lab__intro {
  padding: 1.5rem 1.5rem 1rem;
}
.run-lab__intro > span,
.run-lab small {
  font: 0.65rem var(--automate-font-mono);
  letter-spacing: 0.08em;
  color: var(--automate-fg-muted);
}
.run-lab__intro h3 {
  margin: 0.5rem 0;
  font-size: 1.7rem;
  line-height: 1.2;
  letter-spacing: -0.03em;
}
.run-lab__intro p {
  margin: 0;
  color: var(--automate-fg-muted);
  font-size: 0.95rem;
}
.run-lab__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem 1.5rem;
}
.run-lab__choices button {
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--automate-border-strong);
  border-radius: 0.25rem;
  background: var(--automate-surface);
  color: var(--automate-fg);
  font-size: 0.8rem;
  cursor: pointer;
}
.run-lab__choices button[aria-pressed='true'] {
  background: var(--automate-accent);
  color: var(--automate-on-fill);
  border-color: var(--automate-accent);
}
.run-lab__choices button:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: 3px;
}
.run-lab__canvas {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  border-top: 1px solid var(--automate-border);
  animation: run-arrive 300ms var(--automate-ease-out);
}
.run-lab__timeline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem 1rem;
  background: var(--automate-surface-sunken);
}
.run-lab__attempt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  min-width: 6rem;
}
.run-lab__symbol {
  display: grid;
  place-items: center;
  width: 4.5rem;
  height: 4.5rem;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 2.3rem;
}
.run-lab__attempt strong {
  font-size: 0.85rem;
}
.run-lab__arrow {
  font-size: 1.7rem;
  color: var(--automate-fg-muted);
}
.run-lab__verdict {
  padding: 2rem;
  border-left: 1px solid var(--automate-border);
}
.run-lab__verdict > strong {
  display: block;
  margin: 0.65rem 0;
  font-size: 2.5rem;
  line-height: 1;
  letter-spacing: -0.04em;
}
.run-lab__verdict p {
  margin: 1rem 0 0;
  font-size: 0.95rem;
  line-height: 1.65;
  color: var(--automate-fg-muted);
}
.tone-pass {
  color: var(--automate-success);
}
.tone-fail {
  color: var(--automate-danger);
}
.tone-flaky {
  color: var(--automate-chart-flaky);
}
.tone-unknown {
  color: var(--automate-warning);
}
.run-lab__note {
  margin: 0;
  padding: 0.9rem 1.5rem;
  border-top: 1px solid var(--automate-border);
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--automate-fg-muted);
}
@keyframes run-arrive {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 42rem) {
  .run-lab__canvas {
    grid-template-columns: 1fr;
  }
  .run-lab__verdict {
    border-left: 0;
    border-top: 1px solid var(--automate-border);
  }
}
@media (prefers-reduced-motion: reduce) {
  .run-lab__canvas {
    animation: none;
  }
}
</style>
