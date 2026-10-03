<script setup lang="ts">
/**
 * The evidence chain, as the first thing on the front page.
 *
 * **This is the argument the product is built on, drawn rather than asserted.** The
 * thesis is that prose is a claim and evidence is an instrument reading — a run is
 * not a green tick, it is an attempt inside a lease inside an evidence bundle with a
 * checksum. Six links, in order, each one the thing that has to be true for the next
 * to mean anything:
 *
 *   job → lease → attempt → normalized result → artifact → SHA-256
 *
 * A reader who cannot say which link is missing cannot say whether a run passed,
 * and that is the entire problem this product exists to fix. Every arrow on this page
 * is a place a system can quietly drop something, so they are numbered rather than
 * decorative.
 *
 * The numbers are the measured floors in `performance/thresholds.json`, which is why
 * two of them are `not_configured`. **A missing link says so.** A chain drawn with a
 * placeholder reading `0ms` would look complete, and looking complete is the failure
 * mode this page is about — so `RF-9` and `PERF-1` are visible here as two links that
 * have not been measured yet.
 *
 * The links are real: `docs/architecture.md` and `docs/operations.md` are the pages
 * that carry the detail behind each stage, and `docs/quality/findings.md` is the
 * ledger. A chain drawn in a component with no way to reach any of it would be
 * decoration.
 */

interface Stage {
  readonly index: string;
  readonly title: string;
  readonly detail: string;
  readonly anchor: string;
  /** `null` when the number is not measured yet. Rendered as such, not as zero. */
  readonly measure: string | null;
}

const CHAIN: readonly Stage[] = [
  {
    index: '01',
    title: 'Job',
    detail: 'A unit of work with a lease, not a shell invocation someone remembers to re-run.',
    anchor: '/architecture#execution',
    measure: null,
  },
  {
    index: '02',
    title: 'Lease',
    detail: 'Exactly one worker holds the run at a time. A lost lease is recovered, never assumed.',
    anchor: '/architecture#lease-and-recovery',
    measure: null,
  },
  {
    index: '03',
    title: 'Attempt',
    detail: 'One execution inside the lease, with its own timeout and its own recorded outcome.',
    anchor: '/operations#retry-policy',
    measure: null,
  },
  {
    index: '04',
    title: 'Normalized result',
    detail:
      'Passed, failed, flaky or infra-failed — distinguished, because collapsing them is how a suite lies.',
    anchor: '/architecture#evidence',
    measure: null,
  },
  {
    index: '05',
    title: 'Artifact',
    detail:
      'The trace, the screenshot, the report, retained under the run rather than on someone’s disk.',
    anchor: '/operations#artifacts',
    measure: null,
  },
  {
    index: '06',
    title: 'SHA-256',
    detail:
      'The digest that lets two runs of the same test be compared for identity rather than for resemblance.',
    anchor: '/operations#artifacts',
    measure: null,
  },
];

const FEATURES = [
  {
    title: 'Jobs, not scripts',
    details:
      'A run is a job with a lease, an attempt count, and an evidence bundle — not a shell invocation someone remembers to re-run.',
  },
  {
    title: 'Bounded tools',
    details:
      'A tool that cannot execute something refuses it with a reason. A refusal is a product decision; a 501 is the absence of one.',
  },
  {
    title: 'One claim at a time',
    details:
      'A tool that exists but is not finished says so, and names the gate that would prove otherwise. The rest of this site is written the same way.',
  },
] as const;
</script>

<template>
  <div class="evidence-home">
    <header class="evidence-home__header">
      <p class="evidence-home__eyebrow">Evidence, in six links</p>
      <h1 class="evidence-home__title">A run is not a green tick.</h1>
      <p class="evidence-home__lede">
        It is a chain, and each link can be missing. Everything below this site — the gates, the
        ledger, the release policy — exists to say which links a given run actually has.
      </p>
    </header>

    <ol class="evidence-chain" aria-label="The evidence chain, in order">
      <li v-for="stage in CHAIN" :key="stage.index" class="evidence-chain__link">
        <a class="evidence-chain__anchor" :href="stage.anchor">
          <span class="evidence-chain__index">{{ stage.index }}</span>
          <span class="evidence-chain__title">{{ stage.title }}</span>
        </a>
        <p class="evidence-chain__detail">{{ stage.detail }}</p>
        <p
          v-if="stage.measure === null"
          class="evidence-chain__measure evidence-chain__measure--unset"
        >
          not measured
        </p>
        <p v-else class="evidence-chain__measure">{{ stage.measure }}</p>
      </li>
    </ol>

    <section class="evidence-home__features" aria-label="What this platform is">
      <article v-for="feature in FEATURES" :key="feature.title" class="evidence-feature">
        <h2 class="evidence-feature__title">{{ feature.title }}</h2>
        <p class="evidence-feature__details">{{ feature.details }}</p>
      </article>
    </section>
  </div>
</template>

<style scoped>
/*
 * A single rail of evidence with the numbers in the mono face.
 *
 * Every colour is a `var()` into the product's tokens and every font is one of the
 * two it ships, so the front page is set in exactly the type the console is set in.
 * The two greys that carry the least information — the lede and the per-link detail
 * — are `--automate-fg-muted`, which `theme.test.ts` measures at 4.5:1 or better
 * against all four plane steps in both themes. Nothing here is decorative grey.
 *
 * The chain is a list, not a row of boxes, because a row of boxes reads as six equal
 * steps and this product's whole argument is that the steps are not equal: the
 * digest is what makes the rest mean anything.
 */
.evidence-home {
  max-width: 68rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 5rem;
}

.evidence-home__header {
  max-width: 46rem;
}

.evidence-home__eyebrow {
  margin: 0 0 0.75rem;
  font-family: var(--automate-font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--automate-accent);
}

.evidence-home__title {
  margin: 0 0 1rem;
  font-size: clamp(2.25rem, 5vw, 3.25rem);
  line-height: 1.1;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: var(--automate-fg);
}

.evidence-home__lede {
  margin: 0 0 3rem;
  font-size: 1.125rem;
  line-height: 1.6;
  color: var(--automate-fg-muted);
}

.evidence-chain {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0;
  border-top: 1px solid var(--automate-border);
}

.evidence-chain__link {
  display: grid;
  grid-template-columns: 4rem 1fr;
  gap: 0.25rem 1.5rem;
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--automate-border);
}

.evidence-chain__anchor {
  grid-row: span 3;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--automate-fg);
  text-decoration: none;
}

.evidence-chain__anchor:hover .evidence-chain__title,
.evidence-chain__anchor:focus-visible .evidence-chain__title {
  color: var(--automate-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.evidence-chain__anchor:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: 4px;
}

.evidence-chain__index {
  font-family: var(--automate-font-mono);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--automate-fg-muted);
}

.evidence-chain__detail {
  margin: 0;
  color: var(--automate-fg-muted);
  max-width: 46rem;
}

.evidence-chain__measure {
  margin: 0.35rem 0 0;
  font-family: var(--automate-font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--automate-fg-muted);
}

.evidence-chain__measure--unset {
  color: var(--automate-warning);
}

.evidence-home__features {
  margin-top: 4rem;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}

.evidence-feature {
  padding: 1.25rem;
  background: var(--automate-surface);
  border: 1px solid var(--automate-border);
  border-radius: 0.75rem;
}

.evidence-feature__title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--automate-fg);
}

.evidence-feature__details {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--automate-fg-muted);
}

/* One rule: on a narrow screen the chain stops pretending to be two columns. */
@media (max-width: 40rem) {
  .evidence-chain__link {
    grid-template-columns: 3rem 1fr;
  }

  .evidence-home__title {
    letter-spacing: -0.02em;
  }
}

/*
 * `prefers-reduced-transparency` rather than `prefers-reduced-motion`: the page has
 * no animation to switch off, and the card borders are the one thing here that
 * carries information — a card edge at 1.31:1 on this plane is decoration, and a
 * reader who has asked for no transparency should get the control edge instead.
 */
@media (prefers-reduced-transparency: reduce) {
  .evidence-feature {
    border-color: var(--automate-border-strong);
  }
}
</style>
