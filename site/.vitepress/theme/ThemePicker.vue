<script setup lang="ts">
import { computed } from 'vue';
import { useData } from 'vitepress';
type SiteTheme = 'dark' | 'light' | 'system';
const props = defineProps<{ modelValue: SiteTheme }>();
const emit = defineEmits<{ 'update:modelValue': [value: SiteTheme] }>();
const { lang } = useData();
const next = computed<SiteTheme>(() =>
  props.modelValue === 'light' ? 'dark' : props.modelValue === 'dark' ? 'system' : 'light',
);
const label = computed(() => {
  const names =
    lang.value === 'he'
      ? { light: 'בהיר', dark: 'כהה', system: 'לפי המכשיר' }
      : { light: 'Light', dark: 'Dark', system: 'System' };
  return lang.value === 'he'
    ? `מראה: ${names[props.modelValue]}. מעבר למצב ${names[next.value]}`
    : `Appearance: ${names[props.modelValue]}. Switch to ${names[next.value]}`;
});
</script>
<template>
  <button
    class="theme-picker"
    type="button"
    data-testid="site-theme-toggle"
    :aria-label="label"
    :title="label"
    @click="emit('update:modelValue', next)"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <template v-if="modelValue === 'light'">
        <circle cx="12" cy="12" r="3.5" />
        <path
          d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        />
      </template>
      <path
        v-else-if="modelValue === 'dark'"
        d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"
      />
      <template v-else>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M9 21h6m-3-4v4" />
      </template>
    </svg>
  </button>
</template>
<style scoped>
.theme-picker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 6px;
  color: var(--automate-fg);
  cursor: pointer;
}
.theme-picker svg {
  width: 20px;
  height: 20px;
}
.theme-picker:hover {
  background: var(--automate-surface-muted);
}
.theme-picker:focus-visible {
  outline: 2px solid var(--automate-fg);
  outline-offset: 3px;
}
</style>
