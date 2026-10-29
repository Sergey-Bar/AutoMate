<script setup lang="ts">
import { computed, ref } from 'vue';
import { withBase } from 'vitepress';

const paths = [
  {
    role: 'Explore the product',
    label: 'New to Automate',
    title: 'Understand a result. Follow the evidence.',
    intro: 'Start with the visual tour. No installation or terminal needed to learn the basics.',
    outcome: 'You can explain a run, spot a retry and find the evidence behind a result.',
    steps: [
      {
        title: 'Read your first run',
        detail: 'Explore the annotated product view and learn what each part tells you.',
        link: '/guide/concepts',
      },
      {
        title: 'Try a retry',
        detail: 'Change a test scenario and see why passing on a retry is reported as flaky.',
        link: '/guide/concepts#test-statuses',
      },
      {
        title: 'Understand readiness',
        detail: 'Learn the difference between a failure and a missing signal.',
        link: '/guide/quality-gates',
      },
    ],
  },
  {
    role: 'QA & developers',
    label: 'Connect your tests',
    title: 'Your existing test suite. A clearer result.',
    intro: 'Have a running Automate installation and a report from your test framework ready.',
    outcome: 'Your test report appears as a run, with statuses, retries and the original evidence.',
    steps: [
      {
        title: 'Choose your report',
        detail: 'Start with Playwright JSON, JUnit XML, a k6 summary or a ZAP report.',
        link: '/guide/sending-results#playwright',
      },
      {
        title: 'Send the result',
        detail: 'Follow the upload example, then connect it to your CI job.',
        link: '/guide/sending-results#the-upload',
      },
      {
        title: 'Investigate the outcome',
        detail: 'Read the run and use the retained evidence to understand what happened.',
        link: '/guide/concepts',
      },
    ],
  },
  {
    role: 'Team leads',
    label: 'Make release decisions',
    title: 'Give every release a reason to proceed.',
    intro:
      'Once reports are arriving, use policies and recorded evidence to review release quality.',
    outcome: 'You know which signals passed, which failed and which have not been measured.',
    steps: [
      {
        title: 'Read the quality signals',
        detail: 'Understand passed, failed, unknown and unconfigured domains.',
        link: '/guide/quality-gates',
      },
      {
        title: 'Understand the policy',
        detail: 'See how thresholds produce a verdict that stays attached to its evidence.',
        link: '/guide/quality-gates#quality-gates',
      },
      {
        title: 'Handle unstable tests',
        detail: 'Learn how quarantine records a reason and an explicit decision.',
        link: '/guide/quality-gates#quarantine',
      },
    ],
  },
  {
    role: 'Platform & admins',
    label: 'Run your installation',
    title: 'Your infrastructure. Your evidence.',
    intro: 'You will need Docker with Compose v2 and a machine for the self-hosted installation.',
    outcome: 'Automate is running, and you know how to start, stop and update the installation.',
    steps: [
      {
        title: 'Install Automate',
        detail: 'Download the release bundle and follow the instructions for your system.',
        link: '/guide/install',
      },
      {
        title: 'Choose your setup',
        detail: 'Understand the available deployment profiles before configuring access.',
        link: '/guide/profiles',
      },
      {
        title: 'Operate the stack',
        detail: 'Keep the everyday commands for status, logs and updates close at hand.',
        link: '/guide/install#everyday-commands',
      },
    ],
  },
] as const;
const selected = ref(0);
const path = computed(() => paths[selected.value]);
</script>

<template>
  <section id="start-here" class="start-here" aria-labelledby="start-here-title">
    <div class="start-here__heading">
      <span>YOUR PERSONAL STARTING POINT</span>
      <h2 id="start-here-title">What brings you here?</h2>
      <p>Choose your goal. We’ll walk you through the next three steps.</p>
    </div>
    <div class="start-here__choices" role="group" aria-label="Choose your learning path">
      <button
        v-for="(item, index) in paths"
        :key="item.role"
        :aria-pressed="selected === index"
        @click="selected = index"
      >
        {{ item.role }}
      </button>
    </div>
    <div :key="selected" class="start-here__path" aria-live="polite">
      <div class="start-here__intro">
        <span>{{ path.label }}</span>
        <h3>{{ path.title }}</h3>
        <p>{{ path.intro }}</p>
        <div class="start-here__outcome">
          <span>BY THE END</span>
          <p>{{ path.outcome }}</p>
        </div>
      </div>
      <ol class="start-here__steps">
        <li v-for="(step, index) in path.steps" :key="step.title">
          <a :href="withBase(step.link)"
            ><span class="start-here__number">0{{ index + 1 }}</span>
            <div>
              <strong>{{ step.title }}</strong>
              <p>{{ step.detail }}</p>
            </div>
            <span aria-hidden="true">↗</span></a
          >
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.start-here {
  padding: 6rem 0;
  scroll-margin-top: 5rem;
  color: var(--automate-fg);
}
.start-here__heading {
  max-width: 40rem;
  margin-bottom: 2rem;
}
.start-here__heading > span,
.start-here__intro > span,
.start-here__outcome > span {
  font: 0.68rem var(--automate-font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--automate-fg-muted);
}
.start-here__heading h2 {
  border: 0;
  padding: 0;
  margin: 0.8rem 0 1rem;
  font-size: clamp(2rem, 4vw, 3.5rem);
  line-height: 1.08;
  letter-spacing: -0.045em;
}
.start-here__heading p {
  font-size: 1.1rem;
  line-height: 1.6;
  color: var(--automate-fg-muted);
  margin: 0;
}
.start-here__choices {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.start-here__choices button {
  padding: 0.85rem 1.1rem;
  border: 1px solid var(--automate-border-strong);
  border-radius: 0.3rem;
  background: var(--automate-surface);
  color: var(--automate-fg-muted);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  transition:
    background-color var(--automate-duration-150),
    color var(--automate-duration-150);
}
.start-here__choices button[aria-pressed='true'] {
  background: var(--automate-accent);
  border-color: var(--automate-accent);
  color: var(--automate-on-fill);
}
.start-here__path {
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  border: 1px solid var(--automate-border);
  border-radius: 0.4rem;
  overflow: hidden;
  animation: path-enter 250ms var(--automate-ease-out);
}
.start-here__intro {
  padding: clamp(1.5rem, 4vw, 3rem);
  background: var(--automate-surface);
}
.start-here__intro h3 {
  margin: 1rem 0;
  font-size: clamp(1.6rem, 2.8vw, 2.5rem);
  line-height: 1.12;
  letter-spacing: -0.035em;
}
.start-here__intro p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--automate-fg-muted);
}
.start-here__outcome {
  border-top: 1px solid var(--automate-border);
  padding-top: 1.5rem;
  margin-top: 2rem;
}
.start-here__outcome p {
  margin-top: 0.5rem;
}
.start-here__steps {
  margin: 0;
  padding: 0;
  list-style: none;
}
.start-here__steps li {
  margin: 0;
  border-bottom: 1px solid var(--automate-border);
}
.start-here__steps li:last-child {
  border-bottom: 0;
}
.start-here__steps a {
  display: grid;
  grid-template-columns: 2rem 1fr 1rem;
  gap: 1rem;
  padding: 1.75rem;
  color: var(--automate-fg);
  text-decoration: none;
  transition: background-color var(--automate-duration-100);
}
.start-here__steps a:hover {
  background: var(--automate-surface-raised);
}
.start-here__number {
  font: 0.7rem var(--automate-font-mono);
  color: var(--automate-fg-muted);
  padding-top: 0.25rem;
}
.start-here__steps strong {
  font-size: 1.1rem;
  font-weight: 600;
}
.start-here__steps p {
  margin: 0.45rem 0 0;
  color: var(--automate-fg-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}
.start-here button:focus-visible,
.start-here a:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: -3px;
}
@keyframes path-enter {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 48rem) {
  .start-here__path {
    grid-template-columns: 1fr;
  }
  .start-here {
    padding: 4rem 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .start-here__path {
    animation: none;
  }
}
</style>
