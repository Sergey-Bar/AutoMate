<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import { onMounted, onUnmounted, ref } from 'vue';
import Home from './Home.vue';
import LocalizedHome from './LocalizedHome.vue';
import PageJourney from './PageJourney.vue';
import ThemePicker from './ThemePicker.vue';
import LanguagePicker from './LanguagePicker.vue';
import SiteFooter from './SiteFooter.vue';
import { pageJourneys } from './page-journeys';

/** Public-site shell. Lupin theme preference is independent of the application console. */
const { isDark, page, lang } = useData();

type SiteTheme = 'dark' | 'light' | 'system';

const siteTheme = ref<SiteTheme>('light');
const STORAGE_KEY = 'lupin-site-theme';
let systemPreference: MediaQueryList | undefined;

function syncSystemTheme(): void {
  if (siteTheme.value === 'system' && systemPreference) {
    isDark.value = systemPreference.matches;
    document.documentElement.classList.toggle('dark', isDark.value);
    document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light');
  }
}

onMounted(() => {
  systemPreference = window.matchMedia('(prefers-color-scheme: dark)');
  systemPreference.addEventListener('change', syncSystemTheme);
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* Keep the picker usable when storage is unavailable. */
  }
  apply(saved === 'dark' || saved === 'system' ? saved : 'light', false);
  window.addEventListener('storage', onSavedThemeChange);
});

onUnmounted(() => {
  systemPreference?.removeEventListener('change', syncSystemTheme);
  window.removeEventListener('storage', onSavedThemeChange);
});

function onSavedThemeChange(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return;
  if (event.newValue === null) {
    apply('light', false);
    return;
  }
  if (event.newValue === 'light' || event.newValue === 'dark' || event.newValue === 'system') {
    apply(event.newValue, false);
  }
}

function apply(next: SiteTheme, persist = true): void {
  siteTheme.value = next;
  isDark.value = next === 'system' ? (systemPreference?.matches ?? true) : next === 'dark';
  document.documentElement.classList.toggle('dark', isDark.value);
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light');
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* The current tab still follows the selected appearance. */
    }
  }
}
</script>

<template>
  <DefaultTheme.Layout>
    <template #doc-before>
      <PageJourney
        v-if="pageJourneys[page.relativePath]"
        :key="page.relativePath"
        :journey="pageJourneys[page.relativePath]"
      />
    </template>
    <template #nav-bar-content-after>
      <LanguagePicker />
      <ThemePicker
        class="desktop-theme-picker"
        :model-value="siteTheme"
        @update:model-value="apply"
      />
    </template>

    <template #layout-bottom><SiteFooter /></template>
    <template #home-hero-after>
      <Home v-if="lang === 'en'" />
      <LocalizedHome v-else />
    </template>
  </DefaultTheme.Layout>
</template>
