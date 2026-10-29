<script setup lang="ts">
import { withBase } from 'vitepress';
import runsPreview from '../../../docs/assets/runs.png';
import { githubUrl } from '../locales';
const stages = [
  {
    title: 'Observe',
    text: 'Collect test results and evidence from the tools your team already uses.',
    link: '/guide/sending-results',
    action: 'Connect your test tools',
  },
  {
    title: 'Investigate',
    text: 'Understand failures, retries, flaky tests, and the signals behind each result.',
    link: '/guide/concepts',
    action: 'Follow a test result',
  },
  {
    title: 'Decide',
    text: 'Use explicit quality gates to assess a release. See what passed, failed, or is still unknown.',
    link: '/guide/quality-gates',
    action: 'Understand quality gates',
  },
];
const capabilities = [
  {
    title: 'Unified test results',
    text: 'One consistent result model across supported producers.',
    link: '/guide/sending-results',
  },
  {
    title: 'Evidence preservation',
    text: 'Keep original reports and failure artifacts attached to the results they explain.',
    link: '/guide/concepts',
  },
  {
    title: 'Flaky test intelligence',
    text: 'See retries and inconsistent results without mistaking a later pass for reliability.',
    link: '/guide/concepts#test-statuses',
  },
  {
    title: 'Quality gates',
    text: 'Explicit outcomes, including unknown and not configured. Missing evidence stays visible.',
    link: '/guide/quality-gates',
  },
  {
    title: 'Quarantine management',
    text: 'Manage known flaky tests with reasons and an audit history.',
    link: '/guide/quality-gates',
  },
  {
    title: 'Self-hosted control',
    text: 'Run the platform in your environment. Choose the access profile that fits your team.',
    link: '/guide/profiles',
  },
];
const integrations = [
  ['Playwright', 'Live reporter + JSON import'],
  ['JUnit', 'XML report import'],
  ['k6', 'Summary JSON import'],
  ['OWASP ZAP', 'XML report import'],
  ['Allure', 'Results importer'],
];
</script>
<template>
  <main class="lupin-home">
    <section class="lupin-hero" aria-labelledby="hero-title">
      <p class="lupin-kicker"><span aria-hidden="true"></span> Self-hosted quality intelligence</p>
      <h1 id="hero-title">Know what broke.<br /><span>Know whether to ship.</span></h1>
      <p class="lupin-lead">
        Lupin brings test results, evidence, flaky tests, and quality gates into one self-hosted
        workspace.
      </p>
      <div class="lupin-actions">
        <a class="lupin-button primary" :href="withBase('/guide/install')"
          >Get started <span aria-hidden="true">↗</span></a
        ><a class="lupin-button" :href="githubUrl" target="_blank" rel="noopener noreferrer"
          >View on GitHub <span aria-hidden="true">↗</span></a
        >
      </div>
      <p class="lupin-hero-note">Open source. MIT licensed. Runs on your infrastructure.</p>
    </section>

    <section id="product" class="lupin-showcase" aria-labelledby="showcase-title">
      <div class="lupin-section-line">
        <h2 id="showcase-title">The evidence, in view.</h2>
        <a :href="withBase('/guide/concepts')"
          >Explore the product <span aria-hidden="true">↗</span></a
        >
      </div>
      <figure>
        <img
          :src="runsPreview"
          alt="Existing AutoMate runs overview with run outcomes, release-readiness signals, and recent executions."
          width="1440"
          height="900"
          fetchpriority="high"
          decoding="async"
        />
        <figcaption>
          Current application interface. The screenshot retains AutoMate branding; the Lupin
          identity applies to this website.
        </figcaption>
      </figure>
      <div class="lupin-showcase-notes">
        <p><strong>Results with context</strong>Keep failures and retries visible.</p>
        <p><strong>Evidence you can inspect</strong>Follow the reports behind a result.</p>
        <p><strong>Explicit readiness</strong>Distinguish a failure from a missing signal.</p>
      </div>
    </section>

    <section id="how-it-works" class="lupin-section" aria-labelledby="how-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">How it works</p>
        <h2 id="how-title">Observe. Investigate. Decide.</h2>
        <p>From the first test result to the release decision, keep the context together.</p>
      </div>
      <ol class="lupin-steps">
        <li v-for="(stage, index) in stages" :key="stage.title">
          <span class="lupin-index">0{{ index + 1 }}</span>
          <h3>{{ stage.title }}</h3>
          <p>{{ stage.text }}</p>
          <a :href="withBase(stage.link)">{{ stage.action }} <span aria-hidden="true">↗</span></a>
        </li>
      </ol>
    </section>

    <section class="lupin-section" aria-labelledby="capabilities-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">Core capabilities</p>
        <h2 id="capabilities-title">A clearer picture of quality.</h2>
        <p>The details you need to investigate a failure and assess what comes next.</p>
      </div>
      <div class="lupin-capabilities">
        <article v-for="(item, index) in capabilities" :key="item.title">
          <span class="lupin-index">0{{ index + 1 }}</span>
          <h3>
            <a :href="withBase(item.link)">{{ item.title }} <span aria-hidden="true">↗</span></a>
          </h3>
          <p>{{ item.text }}</p>
        </article>
      </div>
    </section>

    <section class="lupin-section" aria-labelledby="integrations-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">Works with your tools</p>
        <h2 id="integrations-title">Keep your test stack.</h2>
        <p>
          Stream results through the Playwright reporter or import reports from supported tools.
        </p>
      </div>
      <ul class="lupin-integrations">
        <li v-for="item in integrations" :key="item[0]">
          <strong>{{ item[0] }}</strong
          ><span>{{ item[1] }}</span>
        </li>
      </ul>
      <a class="lupin-text-link" :href="withBase('/guide/sending-results')"
        >Read the integration guide <span aria-hidden="true">↗</span></a
      >
    </section>

    <section class="lupin-section lupin-install" aria-labelledby="install-title">
      <div>
        <p class="lupin-kicker">Your infrastructure</p>
        <h2 id="install-title">Self-hosted.<br />From the start.</h2>
        <p>
          Download a release, start Docker, and run the included startup script. Choose a local or
          shared installation profile.
        </p>
        <div class="lupin-actions">
          <a class="lupin-button primary" :href="withBase('/guide/install')">Installation guide</a
          ><a class="lupin-text-link" :href="`${githubUrl}/releases`">Browse releases ↗</a>
        </div>
      </div>
      <div class="lupin-install-panel">
        <p>After extracting the release</p>
        <dl>
          <div>
            <dt>macOS / Linux</dt>
            <dd><code>./start.sh</code></dd>
          </div>
          <div>
            <dt>Windows</dt>
            <dd><code>.\start.cmd</code></dd>
          </div>
        </dl>
        <p class="lupin-technical-note">
          Requires Docker with Compose v2. Release files, packages, and commands still use the
          <code>automate</code> name.
        </p>
      </div>
    </section>

    <section class="lupin-section lupin-open" aria-labelledby="open-title">
      <div>
        <p class="lupin-kicker">Open source</p>
        <h2 id="open-title">Inspect the code.<br />Understand the decisions.</h2>
      </div>
      <div>
        <p>
          MIT licensed, with source code, issue tracking, and contribution guidelines in the public
          repository.
        </p>
        <a class="lupin-text-link" :href="`${githubUrl}/blob/main/.github/CONTRIBUTING.md`"
          >Read the contributing guide ↗</a
        >
      </div>
    </section>

    <section class="lupin-closing" aria-labelledby="closing-title">
      <p class="lupin-kicker">Lupin</p>
      <h2 id="closing-title">Make quality a decision,<br />not a guess.</h2>
      <div class="lupin-actions">
        <a class="lupin-button primary" :href="withBase('/guide/install')">Get started ↗</a
        ><a class="lupin-button" :href="withBase('/guide/')">View documentation</a>
      </div>
    </section>
  </main>
</template>
