<script setup lang="ts">
import { ref } from 'vue';

type View = 'runs' | 'evidence' | 'gates';

const views = [
  {
    id: 'runs',
    number: '01',
    title: 'See every run',
    detail: 'A clear outcome for each run, with retries kept visible.',
  },
  {
    id: 'evidence',
    number: '02',
    title: 'Follow the evidence',
    detail: 'Keep reports and artifacts attached to the result they explain.',
  },
  {
    id: 'gates',
    number: '03',
    title: 'Make the call',
    detail: 'Know when a signal passed, failed, or was never configured.',
  },
] as const;

const activeView = ref<View>('runs');

const exampleRuns = [
  {
    name: 'Browser regression',
    tests: '128 tests',
    time: '09:42',
    outcome: 'Passed',
    tone: 'pass',
  },
  { name: 'Checkout flow', tests: '24 tests', time: '09:18', outcome: 'Flaky', tone: 'flaky' },
  { name: 'API contract', tests: '86 tests', time: '08:53', outcome: 'Failed', tone: 'fail' },
] as const;

function select(view: View): void {
  activeView.value = view;
}
</script>

<template>
  <section id="explore" class="tour" aria-labelledby="tour-title">
    <div class="tour__heading">
      <p class="tour__eyebrow">INSIDE AUTOMATE</p>
      <h2 id="tour-title">A clearer way to see quality.</h2>
      <p>Explore the path from a test run to the decision it supports.</p>
    </div>

    <div class="tour__layout">
      <div class="tour__choices" role="group" aria-label="Explore product views">
        <button
          v-for="view in views"
          :key="view.id"
          type="button"
          class="tour__choice"
          :class="{ 'tour__choice--active': activeView === view.id }"
          :aria-pressed="activeView === view.id"
          :aria-controls="`tour-panel-${view.id}`"
          @click="select(view.id)"
        >
          <span class="tour__number">{{ view.number }}</span>
          <span class="tour__choice-copy"
            ><strong>{{ view.title }}</strong
            ><small>{{ view.detail }}</small></span
          >
          <span class="tour__arrow" aria-hidden="true">↗</span>
        </button>
      </div>

      <div class="tour__stage" aria-live="polite">
        <div class="tour__stage-bar">
          <span>AUTOMATE / {{ activeView.toUpperCase() }}</span>
          <span>ILLUSTRATIVE PREVIEW</span>
        </div>

        <div v-show="activeView === 'runs'" id="tour-panel-runs" class="tour__panel">
          <div class="tour__panel-heading">
            <div>
              <span>YOUR WORKSPACE</span>
              <h3>Runs</h3>
            </div>
            <span class="tour__live"><i aria-hidden="true"></i> RUN SUMMARY</span>
          </div>
          <div class="tour__metrics">
            <div><small>TOTAL RUNS</small><strong>03</strong></div>
            <div><small>PASSED</small><strong class="tone--pass">01</strong></div>
            <div><small>NEEDS ATTENTION</small><strong class="tone--fail">02</strong></div>
          </div>
          <div class="tour__table" role="table" aria-label="Illustrative test runs">
            <div class="tour__table-head" role="row">
              <span role="columnheader">RUN</span><span role="columnheader">TESTS</span
              ><span role="columnheader">TIME</span><span role="columnheader">OUTCOME</span>
            </div>
            <div v-for="run in exampleRuns" :key="run.name" class="tour__table-row" role="row">
              <strong role="cell">{{ run.name }}</strong
              ><span role="cell">{{ run.tests }}</span
              ><span role="cell">{{ run.time }}</span
              ><span role="cell" class="tour__outcome" :class="`tone--${run.tone}`"
                ><i aria-hidden="true"></i>{{ run.outcome }}</span
              >
            </div>
          </div>
        </div>

        <div v-show="activeView === 'evidence'" id="tour-panel-evidence" class="tour__panel">
          <div class="tour__panel-heading">
            <div>
              <span>RUN / CHECKOUT FLOW</span>
              <h3>Evidence</h3>
            </div>
            <span class="tone--flaky">FLAKY</span>
          </div>
          <div class="tour__evidence-lede">
            One retry passed. The first failure and its artifacts remain part of the run.
          </div>
          <div class="tour__artifact">
            <span class="tour__artifact-icon">01</span>
            <div><strong>Playwright trace</strong><small>First attempt · Browser</small></div>
            <span>TRACE</span>
          </div>
          <div class="tour__artifact">
            <span class="tour__artifact-icon">02</span>
            <div><strong>Failure screenshot</strong><small>First attempt · Browser</small></div>
            <span>IMAGE</span>
          </div>
          <div class="tour__artifact">
            <span class="tour__artifact-icon">03</span>
            <div><strong>Original test report</strong><small>Stored with the run</small></div>
            <span>REPORT</span>
          </div>
          <p class="tour__panel-foot">RETAIN THE CONTEXT. INVESTIGATE WITH CONFIDENCE.</p>
        </div>

        <div v-show="activeView === 'gates'" id="tour-panel-gates" class="tour__panel">
          <div class="tour__panel-heading">
            <div>
              <span>RELEASE / READINESS</span>
              <h3>Quality gates</h3>
            </div>
            <span class="tone--unset">UNKNOWN</span>
          </div>
          <p class="tour__gate-lede">A gate only answers when its signal exists.</p>
          <div class="tour__gate">
            <div><span>01</span><strong>Browser</strong></div>
            <b class="tone--pass">PASSED</b>
          </div>
          <div class="tour__gate">
            <div><span>02</span><strong>API</strong></div>
            <b class="tone--fail">FAILED</b>
          </div>
          <div class="tour__gate">
            <div><span>03</span><strong>Performance</strong></div>
            <b class="tone--unset">NOT CONFIGURED</b>
          </div>
          <p class="tour__panel-foot">NO SILENT PASS WHEN NOTHING WAS MEASURED.</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tour {
  scroll-margin-top: 5rem;
  padding: clamp(5rem, 9vw, 9rem) 0;
  border-top: 1px solid var(--automate-border);
}
.tour__heading {
  max-width: 42rem;
  margin-bottom: clamp(2.5rem, 5vw, 4rem);
}
.tour__eyebrow,
.tour__number,
.tour__stage-bar,
.tour__panel-heading > div > span,
.tour__live,
.tour__metrics small,
.tour__table-head,
.tour__artifact > span:last-child,
.tour__panel-foot {
  font-family: var(--automate-font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  color: var(--automate-fg-muted);
}
.tour__eyebrow {
  margin: 0 0 1rem;
}
.tour h2 {
  margin: 0;
  font-size: clamp(2.25rem, 4.5vw, 4rem);
  line-height: 1.04;
  letter-spacing: -0.045em;
  color: var(--automate-fg);
}
.tour__heading > p:last-child {
  margin: 1.25rem 0 0;
  font-size: 1.1rem;
  line-height: 1.6;
  color: var(--automate-fg-muted);
}
.tour__layout {
  display: grid;
  grid-template-columns: minmax(15rem, 0.7fr) minmax(0, 1.3fr);
  gap: clamp(1.5rem, 4vw, 4.5rem);
  align-items: stretch;
}
.tour__choices {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--automate-border);
}
.tour__choice {
  position: relative;
  display: grid;
  grid-template-columns: 2rem 1fr 1rem;
  gap: 1rem;
  align-items: start;
  width: 100%;
  padding: 1.75rem 0;
  border: 0;
  border-bottom: 1px solid var(--automate-border);
  background: transparent;
  color: var(--automate-fg-muted);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--automate-duration-100) var(--automate-ease-out),
    padding-left var(--automate-duration-150) var(--automate-ease-out);
}
.tour__choice::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.8rem;
  bottom: 0.8rem;
  width: 2px;
  background: var(--automate-accent);
  transform: scaleY(0);
  transform-origin: top;
  transition: transform var(--automate-duration-150) var(--automate-ease-out);
}
.tour__choice--active {
  color: var(--automate-fg);
  padding-left: 0.75rem;
}
.tour__choice--active::before {
  transform: scaleY(1);
}
.tour__choice--active .tour__number {
  color: var(--automate-accent);
}
.tour__choice-copy {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tour__choice-copy strong {
  font-size: 1.25rem;
  line-height: 1.2;
  font-weight: 600;
}
.tour__choice-copy small {
  max-width: 18rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--automate-fg-muted);
}
.tour__arrow {
  justify-self: end;
  font-size: 1.1rem;
  opacity: 0;
}
.tour__choice:hover .tour__arrow,
.tour__choice--active .tour__arrow {
  opacity: 1;
}
.tour__choice:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: 3px;
}
.tour__stage {
  overflow: hidden;
  min-height: 31rem;
  border: 1px solid var(--automate-border-strong);
  border-radius: 0.3rem;
  background: var(--automate-surface);
}
.tour__stage-bar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.3rem;
  border-bottom: 1px solid var(--automate-border);
  background: var(--automate-surface-raised);
}
.tour__panel {
  padding: clamp(1.25rem, 2.5vw, 2.5rem);
  animation: tour-enter var(--automate-duration-150) var(--automate-ease-out);
}
@keyframes tour-enter {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.tour__panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}
.tour__panel-heading h3 {
  margin: 0.3rem 0 0;
  font-size: 2rem;
  letter-spacing: -0.04em;
  line-height: 1.1;
  color: var(--automate-fg);
}
.tour__panel-heading > span {
  font-family: var(--automate-font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  white-space: nowrap;
}
.tour__live {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.tour__live i,
.tour__outcome i {
  display: inline-block;
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: currentColor;
}
.tour__live i {
  color: var(--automate-success);
}
.tour__metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 2rem;
}
.tour__metrics > div {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1.2rem;
  border: 1px solid var(--automate-border);
}
.tour__metrics strong {
  font-family: var(--automate-font-mono);
  font-size: 2rem;
  line-height: 1;
  color: var(--automate-fg);
}
.tour__table-head,
.tour__table-row {
  display: grid;
  grid-template-columns: 2fr 1fr 0.7fr 1fr;
  gap: 0.6rem;
  align-items: center;
}
.tour__table-head {
  padding: 0.75rem 0.5rem;
  border-bottom: 1px solid var(--automate-border-strong);
}
.tour__table-row {
  min-height: 3.5rem;
  padding: 0.75rem 0.5rem;
  border-bottom: 1px solid var(--automate-border);
  font-size: 0.82rem;
  color: var(--automate-fg-muted);
  transition: background-color var(--automate-duration-100) var(--automate-ease-out);
}
.tour__table-row:hover {
  background: var(--automate-surface-raised);
}
.tour__table-row strong {
  color: var(--automate-fg);
  font-weight: 600;
}
.tour__outcome {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}
.tone--pass,
.tour__metrics strong.tone--pass {
  color: var(--automate-success);
}
.tone--fail,
.tour__metrics strong.tone--fail {
  color: var(--automate-danger);
}
.tone--flaky {
  color: var(--automate-chart-flaky);
}
.tone--unset {
  color: var(--automate-warning);
}
.tour__evidence-lede,
.tour__gate-lede {
  max-width: 30rem;
  margin: 0 0 2rem;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--automate-fg-muted);
}
.tour__artifact {
  display: grid;
  grid-template-columns: 2.5rem 1fr auto;
  align-items: center;
  gap: 1rem;
  min-height: 5rem;
  border-top: 1px solid var(--automate-border);
  transition: background-color var(--automate-duration-100) var(--automate-ease-out);
}
.tour__artifact:hover {
  background: var(--automate-surface-raised);
}
.tour__artifact-icon {
  width: 2.25rem;
  height: 2.25rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--automate-border-strong);
  font-family: var(--automate-font-mono);
  font-size: 0.68rem;
  color: var(--automate-fg-muted);
}
.tour__artifact > div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.tour__artifact strong,
.tour__gate strong {
  font-size: 0.9rem;
  color: var(--automate-fg);
  font-weight: 600;
}
.tour__artifact small {
  font-size: 0.75rem;
  color: var(--automate-fg-muted);
}
.tour__gate {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  min-height: 4.4rem;
  border-top: 1px solid var(--automate-border);
  transition: background-color var(--automate-duration-100) var(--automate-ease-out);
}
.tour__gate:hover {
  background: var(--automate-surface-raised);
}
.tour__gate > div {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
}
.tour__gate span {
  font-family: var(--automate-font-mono);
  font-size: 0.7rem;
  color: var(--automate-fg-muted);
}
.tour__gate b {
  font-family: var(--automate-font-mono);
  font-size: 0.68rem;
}
.tour__panel-foot {
  margin: 1.5rem 0 0;
}
@media (max-width: 52rem) {
  .tour__layout {
    grid-template-columns: 1fr;
  }
  .tour__choices {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .tour__choice {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    border-right: 1px solid var(--automate-border);
  }
  .tour__choice:last-child {
    border-right: 0;
  }
  .tour__choice-copy small,
  .tour__arrow {
    display: none;
  }
  .tour__choice-copy strong {
    font-size: 0.88rem;
  }
}
@media (max-width: 36rem) {
  .tour__stage-bar span:last-child {
    display: none;
  }
  .tour__metrics {
    gap: 0.4rem;
  }
  .tour__metrics > div {
    padding: 0.65rem;
  }
  .tour__metrics small {
    font-size: 0.55rem;
  }
  .tour__metrics strong {
    font-size: 1.4rem;
  }
  .tour__table-head,
  .tour__table-row {
    grid-template-columns: 1.5fr 0.7fr 1fr;
  }
  .tour__table-head span:nth-child(3),
  .tour__table-row > span:nth-child(3) {
    display: none;
  }
  .tour__table-row {
    font-size: 0.72rem;
  }
  .tour__panel-heading h3 {
    font-size: 1.6rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tour__panel {
    animation: none;
  }
  .tour__choice {
    transition: none;
  }
  .tour__choice::before {
    transition: none;
  }
}
</style>
