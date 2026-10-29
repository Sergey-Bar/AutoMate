<script setup lang="ts">
import { computed } from 'vue';

import { useData, withBase } from 'vitepress';
import { translations } from '../locales';
import preview from '../../../docs/assets/runs.png';
const { lang } = useData();
const copy = computed(
  () =>
    translations.find((item) => item.lang === lang.value) ??
    translations.find((item) => item.code === 'en')!,
);
</script>
<template>
  <main class="localized-home" :dir="['ar', 'he'].includes(copy.code) ? 'rtl' : 'ltr'">
    <p class="localized-home__brand">Lupin</p>
    <h1>{{ copy.title }}</h1>
    <p class="localized-home__description">{{ copy.description }}</p>
    <div class="localized-home__actions">
      <a class="primary" :href="withBase('/guide/install')"
        >{{ copy.start }} <span aria-hidden="true">↗</span></a
      >
    </div>
    <p class="localized-home__note">{{ copy.note }}</p>
    <figure lang="en" dir="ltr">
      <img
        :src="preview"
        alt="Current AutoMate interface showing test runs, outcomes, and release-readiness signals"
        width="1440"
        height="900"
      />
      <figcaption>
        Current application interface — AutoMate branding. The Lupin identity applies to this
        website.
      </figcaption>
    </figure>

    <a class="localized-home__docs" :href="withBase('/guide/')">{{ copy.docs }} →</a>
  </main>
</template>
<style scoped>
.localized-home {
  max-width: 76rem;
  margin: auto;
  padding: clamp(3rem, 7vw, 7rem) 1.5rem 5rem;
  text-align: center;
}
.localized-home__brand {
  font: 0.75rem var(--automate-font-mono);
  letter-spacing: 0.25em;
  color: var(--automate-fg-muted);
}
h1 {
  max-width: 64rem;
  margin: 1.5rem auto;
  font-size: clamp(2.5rem, 6vw, 6rem);
  font-weight: 700;
  line-height: 1.12;
  text-wrap: balance;
}
.localized-home__description {
  max-width: 44rem;
  margin: 0 auto;
  font-size: 1.25rem;
  line-height: 1.7;
  color: var(--automate-fg-muted);
}
.localized-home__actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
  margin: 2rem 0 1rem;
}
.localized-home__actions a {
  padding: 0.85rem 1.5rem;
  border: 1px solid var(--automate-border-strong);
  border-radius: 6px;
  font-weight: 600;
}
a.primary {
  background: var(--automate-fg);
  color: var(--automate-surface-sunken);
}
a:focus-visible {
  outline: 2px solid var(--automate-fg);
  outline-offset: 4px;
}
.localized-home__note,
figcaption {
  color: var(--automate-fg-muted);
  font-size: 0.85rem;
  line-height: 1.6;
}
figure {
  margin: 3rem 0 2rem;
}
img {
  width: 100%;
  height: auto;
  border: 1px solid var(--automate-border);
  border-radius: 8px;
}
figcaption {
  margin-top: 1rem;
}
.localized-home__docs {
  text-decoration: underline;
  text-underline-offset: 5px;
}
</style>
