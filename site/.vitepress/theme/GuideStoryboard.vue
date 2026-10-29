<script setup lang="ts">
import { computed, ref } from 'vue';
import runsPreview from '../../../docs/assets/runs.png';

type Kind = 'concepts' | 'upload' | 'gates';
type Scene = { title: string; summary: string; detail: string; token: string };

const props = defineProps<{ kind: Kind }>();
const content: Record<Kind, { eyebrow: string; title: string; scenes: Scene[] }> = {
  concepts: {
    eyebrow: 'FOLLOW THE EVIDENCE',
    title: 'A run is a story you can verify.',
    scenes: [
      {
        title: 'Job',
        summary: 'Work is requested',
        detail: 'A job records what should run, its deadline and the capabilities it needs.',
        token: '01',
      },
      {
        title: 'Lease',
        summary: 'A runner takes ownership',
        detail:
          'A time-limited claim prevents a runner that lost ownership from completing old work.',
        token: '02',
      },
      {
        title: 'Attempt',
        summary: 'The work executes',
        detail:
          'One execution of a job. If its lease is lost, the job can be requeued as a new attempt, up to its attempt limit.',
        token: '03',
      },
      {
        title: 'Result',
        summary: 'Statuses become comparable',
        detail: 'The report is normalized into tests, outcomes, retries and durations.',
        token: '04',
      },
      {
        title: 'Artifact',
        summary: 'The original is kept',
        detail: 'Reports and declared files remain attached to the result they explain.',
        token: '05',
      },
      {
        title: 'Digest',
        summary: 'The bytes have an identity',
        detail: 'A SHA-256 digest identifies the exact uploaded report and recognizes a replay.',
        token: '06',
      },
    ],
  },
  upload: {
    eyebrow: 'FROM CI TO CONSOLE',
    title: 'Keep your tools. Connect their output.',
    scenes: [
      {
        title: 'Run tests',
        summary: 'Use the suite you know',
        detail: 'Playwright, JUnit-compatible runners, k6 and ZAP produce their usual reports.',
        token: '01',
      },
      {
        title: 'Upload',
        summary: 'Send one report',
        detail: 'A multipart upload sends the file with its format and optional CI context.',
        token: '02',
      },
      {
        title: 'Normalize',
        summary: 'Read one model',
        detail:
          'The matching adapter turns the producer format into comparable tests and outcomes.',
        token: '03',
      },
      {
        title: 'Investigate',
        summary: 'Open the evidence',
        detail: 'The console keeps the normalized result next to the original uploaded bytes.',
        token: '04',
      },
    ],
  },
  gates: {
    eyebrow: 'RELEASE DECISIONS',
    title: 'Every signal gets an explicit state.',
    scenes: [
      {
        title: 'Passed',
        summary: 'Evidence meets policy',
        detail: 'A measured domain satisfies the threshold required by the quality policy.',
        token: '01',
      },
      {
        title: 'Failed',
        summary: 'Evidence breaks policy',
        detail: 'The domain was measured, but the result does not meet the threshold.',
        token: '02',
      },
      {
        title: 'Unknown',
        summary: 'Evidence could not be read',
        detail: 'An unreadable or incomplete signal cannot be rounded up to a pass.',
        token: '03',
      },
      {
        title: 'Not configured',
        summary: 'No signal was collected',
        detail: 'A domain without an execution adapter is shown as absent, never green.',
        token: '04',
      },
    ],
  },
};

const selected = ref(0);
const hotspot = ref(0);
const examples = [
  {
    heading: 'Checkout regression',
    rows: ['Browser tests', 'Timeout · 5 minutes', 'Required capability · browser'],
    footer: 'The job describes the work to be done.',
  },
  {
    heading: 'Runner claims job',
    rows: ['Job → Runner 01', 'Lease · active', 'Fencing token · attached'],
    footer: 'Only the current lease owner can finish the job.',
  },
  {
    heading: 'Execution attempt',
    rows: ['Prepare browser ✓', 'Execute tests →', 'Collect report · next'],
    footer: 'An execution attempt belongs to one job.',
  },
  {
    heading: 'Normalized report',
    rows: ['Checkout · passed', 'Coupon · flaky', 'Payment · failed'],
    footer: 'Different report formats become one readable model.',
  },
  {
    heading: 'Evidence attached',
    rows: [
      'results.json · original report',
      'trace.zip · declared artifact',
      'failure.png · declared artifact',
    ],
    footer: 'Open the files that explain the result.',
  },
  {
    heading: 'Report fingerprint',
    rows: ['SHA-256', 'Exact report bytes → digest', 'Same bytes → same identity'],
    footer: 'The digest identifies the report that arrived.',
  },
];
const hotspots = [
  {
    label: 'Outcomes',
    x: 30,
    y: 53,
    explanation:
      'Read the outcome of each run here. A failed run remains visible beside the runs that passed.',
  },
  {
    label: 'Readiness',
    x: 85,
    y: 43,
    explanation:
      'Check each release signal. UNKNOWN and NOT_CONFIGURED show where evidence is still missing.',
  },
  {
    label: 'Executions',
    x: 85,
    y: 78,
    explanation:
      'Recent executions keep the latest activity in view while you investigate a result.',
  },
];
const story = computed(() => content[props.kind]);
const current = computed(() => story.value.scenes[selected.value] ?? story.value.scenes[0]);

function select(index: number): void {
  selected.value = index;
}

function next(): void {
  selected.value = (selected.value + 1) % story.value.scenes.length;
}
</script>

<template>
  <section class="story" :aria-label="story.title">
    <div class="story__header">
      <span>{{ story.eyebrow }}</span>
      <h2>{{ story.title }}</h2>
      <p>Select a step to see what it means in the product.</p>
    </div>

    <div class="story__rail" role="group" :aria-label="`${kind} steps`">
      <button
        v-for="(scene, index) in story.scenes"
        :key="scene.title"
        type="button"
        :aria-pressed="selected === index"
        :class="{ 'is-selected': selected === index }"
        @click="select(index)"
      >
        <span>{{ scene.token }}</span>
        <strong>{{ scene.title }}</strong>
      </button>
    </div>

    <div class="story__stage">
      <div class="story__visual">
        <div v-if="kind === 'concepts'" :key="selected" class="story__example">
          <span class="story__example-label">ILLUSTRATIVE EXAMPLE / {{ current.token }}</span>
          <svg class="story__example-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <rect x="10" y="8" width="44" height="48" rx="5" />
            <path d="M20 20h24M20 30h15M20 40h24" />
            <circle cx="48" cy="48" r="12" />
            <path d="m42 48 4 4 8-9" />
          </svg>
          <strong>{{ examples[selected].heading }}</strong>
          <div
            v-for="(row, index) in examples[selected].rows"
            :key="row"
            class="story__example-row"
            :style="{ animationDelay: `${index * 70}ms` }"
          >
            <span>0{{ index + 1 }}</span
            >{{ row }}
          </div>
          <small>{{ examples[selected].footer }}</small>
        </div>
        <template v-else-if="kind === 'gates'">
          <div
            v-for="(scene, index) in story.scenes"
            :key="scene.title"
            class="story__signal"
            :class="{ 'is-selected': selected === index }"
          >
            <i></i><span>{{ scene.title }}</span
            ><b>{{ index === selected ? 'IN FOCUS' : 'SIGNAL' }}</b>
          </div>
        </template>
        <template v-else>
          <div class="story__source">
            <span>{{ kind === 'upload' ? 'YOUR CI' : 'EXECUTION' }}</span
            ><strong>{{ kind === 'upload' ? 'Test report' : 'Run request' }}</strong>
          </div>
          <div class="story__line">
            <span :style="{ width: `${((selected + 1) / story.scenes.length) * 100}%` }"></span>
          </div>
          <div class="story__destination">
            <span>AUTOMATE</span><strong>{{ current.title }}</strong
            ><small>{{ current.summary }}</small>
          </div>
        </template>
      </div>
      <div class="story__explanation" aria-live="polite">
        <span>{{ current.token }} / 0{{ story.scenes.length }}</span>
        <h3 :key="current.title">{{ current.summary }}</h3>
        <p :key="current.detail">{{ current.detail }}</p>
        <button type="button" @click="next">Next step <span aria-hidden="true">→</span></button>
      </div>
    </div>

    <figure v-if="kind === 'concepts'" class="story__screenshot">
      <div class="story__image-wrap">
        <img
          :src="runsPreview"
          alt="Automate runs screen with outcome badges, recent executions and release readiness shown together"
          loading="lazy"
        />
        <button
          v-for="(point, index) in hotspots"
          :key="point.label"
          class="story__hotspot"
          :class="{ 'is-selected': hotspot === index }"
          :style="{ left: `${point.x}%`, top: `${point.y}%` }"
          :aria-label="`Explain ${point.label.toLowerCase()}`"
          :aria-pressed="hotspot === index"
          @click="hotspot = index"
        >
          {{ index + 1 }}
        </button>
      </div>
      <figcaption>
        <span>CLICK A NUMBER TO EXPLORE</span>
        <div aria-live="polite">
          <strong>{{ hotspots[hotspot].label }}</strong>
          <p>{{ hotspots[hotspot].explanation }}</p>
        </div>
      </figcaption>
    </figure>
  </section>
</template>

<style scoped>
.story__example {
  width: 100%;
  padding: 1.2rem;
  background: var(--automate-surface);
  border: 1px solid var(--automate-border-strong);
  animation: scene-enter 300ms var(--automate-ease-out);
}
.story__example-label {
  display: block;
  font: 0.6rem var(--automate-font-mono);
  letter-spacing: 0.08em;
  color: var(--automate-fg-muted);
}
.story__example-icon {
  width: 4rem;
  height: 4rem;
  margin: 1rem 0;
  stroke: var(--automate-fg);
  stroke-width: 1.5;
}
.story__example-icon circle {
  fill: var(--automate-surface);
}
.story__example > strong {
  display: block;
  margin-bottom: 1rem;
  font-size: 1.2rem;
  color: var(--automate-fg);
}
.story__example-row {
  display: flex;
  gap: 0.7rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--automate-border);
  font-size: 0.8rem;
  animation: scene-enter 300ms var(--automate-ease-out) both;
}
.story__example-row > span {
  color: var(--automate-fg-muted);
  font: 0.65rem var(--automate-font-mono);
}
.story__example > small {
  display: block;
  margin-top: 1rem;
  color: var(--automate-fg-muted);
  line-height: 1.5;
}
.story__image-wrap {
  position: relative;
}
.story__hotspot {
  position: absolute;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  transform: translate(-50%, -50%);
  border: 2px solid var(--automate-accent);
  border-radius: 50%;
  background: var(--automate-surface);
  color: var(--automate-fg);
  font-weight: 700;
  cursor: pointer;
}
.story__hotspot.is-selected {
  background: var(--automate-accent);
  color: var(--automate-on-fill);
}
.story__screenshot figcaption > div {
  max-width: 28rem;
}
.story__screenshot figcaption p {
  margin: 0.4rem 0 0;
  font-size: 0.85rem;
  line-height: 1.6;
}
.story__screenshot figcaption strong {
  font-size: 1rem;
  color: var(--automate-fg);
}
.story {
  margin: 2rem 0 3rem;
  border: 1px solid var(--automate-border);
  border-radius: 0.35rem;
  background: var(--automate-surface);
  overflow: hidden;
}
.story__header {
  padding: clamp(1.25rem, 4vw, 2.5rem);
}
.story__header > span,
.story__source span,
.story__destination span,
.story__explanation > span,
.story__screenshot figcaption span {
  font-family: var(--automate-font-mono);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--automate-fg-muted);
}
.story__header h2 {
  margin: 0.55rem 0 0;
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  line-height: 1.12;
  letter-spacing: -0.035em;
  color: var(--automate-fg);
}
.story__header p {
  margin: 0.7rem 0 0;
  font-size: 0.9rem;
  color: var(--automate-fg-muted);
}
.story__rail {
  display: flex;
  overflow-x: auto;
  border-top: 1px solid var(--automate-border);
  border-bottom: 1px solid var(--automate-border);
  scrollbar-width: thin;
}
.story__rail button {
  position: relative;
  flex: 1 0 auto;
  min-width: 6.5rem;
  display: grid;
  gap: 0.25rem;
  padding: 1rem 0.8rem;
  border: 0;
  border-right: 1px solid var(--automate-border);
  background: var(--automate-surface);
  color: var(--automate-fg-muted);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--automate-duration-100) var(--automate-ease-out),
    color var(--automate-duration-100) var(--automate-ease-out);
}
.story__rail button:last-child {
  border-right: 0;
}
.story__rail button:hover,
.story__rail button.is-selected {
  background: var(--automate-surface-raised);
  color: var(--automate-fg);
}
.story__rail button.is-selected::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--automate-accent);
}
.story__rail button span {
  font-family: var(--automate-font-mono);
  font-size: 0.65rem;
}
.story__rail button strong {
  font-size: 0.85rem;
  font-weight: 600;
}
.story button:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: -3px;
}
.story__stage {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(14rem, 0.8fr);
  min-height: 18rem;
}
.story__visual {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: clamp(1rem, 3vw, 2rem);
  border-right: 1px solid var(--automate-border);
  background: var(--automate-surface-sunken);
}
.story__source,
.story__destination {
  display: grid;
  gap: 0.45rem;
  min-width: 7rem;
  padding: 1.1rem;
  border: 1px solid var(--automate-border-strong);
  background: var(--automate-surface);
}
.story__source strong,
.story__destination strong {
  font-size: clamp(0.9rem, 1.5vw, 1.25rem);
  line-height: 1.15;
  color: var(--automate-fg);
}
.story__destination strong {
  animation: scene-enter var(--automate-duration-150) var(--automate-ease-out);
}
.story__destination small {
  font-size: 0.7rem;
  line-height: 1.35;
  color: var(--automate-fg-muted);
}
.story__line {
  flex: 1;
  height: 2px;
  background: var(--automate-border-strong);
}
.story__line span {
  display: block;
  height: 100%;
  background: var(--automate-accent);
  transition: width 0.4s var(--automate-ease-out);
}
.story__explanation {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(1.25rem, 3vw, 2.5rem);
}
.story__explanation h3 {
  margin: 1.5rem 0 0;
  font-size: clamp(1.25rem, 2vw, 1.75rem);
  line-height: 1.2;
  letter-spacing: -0.025em;
  color: var(--automate-fg);
  animation: scene-enter var(--automate-duration-150) var(--automate-ease-out);
}
.story__explanation p {
  margin: 0.8rem 0 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--automate-fg-muted);
  animation: scene-enter var(--automate-duration-150) var(--automate-ease-out);
}
.story__explanation button {
  align-self: start;
  display: inline-flex;
  gap: 0.6rem;
  margin-top: 1.7rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--automate-fg);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.story__signal {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--automate-border);
  color: var(--automate-fg-muted);
  transition:
    background-color var(--automate-duration-150) var(--automate-ease-out),
    border-color var(--automate-duration-150) var(--automate-ease-out);
}
.story__signal.is-selected {
  background: var(--automate-surface);
  border-color: var(--automate-accent);
  color: var(--automate-fg);
}
.story__signal i {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: currentColor;
}
.story__signal span {
  font-size: 0.86rem;
  font-weight: 600;
}
.story__signal b {
  margin-left: auto;
  font-family: var(--automate-font-mono);
  font-size: 0.57rem;
  font-weight: 600;
}
.story__visual:has(.story__signal) {
  flex-direction: column;
  gap: 0.4rem;
}
.story__screenshot {
  margin: 0;
  border-top: 1px solid var(--automate-border);
}
.story__screenshot img {
  display: block;
  width: 100%;
  height: auto;
}
.story__screenshot figcaption {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.25rem;
  border-top: 1px solid var(--automate-border);
  color: var(--automate-fg-muted);
  font-size: 0.75rem;
  line-height: 1.4;
}
@keyframes scene-enter {
  from {
    opacity: 0;
    transform: translateY(0.35rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 42rem) {
  .story__stage {
    grid-template-columns: 1fr;
  }
  .story__visual {
    min-height: 12rem;
    border-right: 0;
    border-bottom: 1px solid var(--automate-border);
  }
  .story__screenshot figcaption {
    flex-direction: column;
  }
}
@media (prefers-reduced-motion: reduce) {
  .story__example,
  .story__example-row {
    animation: none;
  }
  .story__destination strong,
  .story__explanation h3,
  .story__explanation p {
    animation: none;
  }
  .story__line span {
    transition: none;
  }
}
</style>
