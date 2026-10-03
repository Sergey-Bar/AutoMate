<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import { computed } from 'vue';
import Home from './Home.vue';

/**
 * The site shell: the default theme's chrome, a theme switch, and the front page.
 *
 * **The switch exists because the product has one.** `apps/web` ships dark and light
 * palettes, the tokens this site imports are defined in both, and a documentation
 * site that can only ever show you one of them is a site that cannot document the
 * other. So the control is here rather than being dropped because VitePress's default
 * theme does not ship one.
 *
 * The label names the *destination*, not the current state, which is the same
 * decision `ThemeToggle.tsx` makes in the product and for the same reason: "Toggle
 * theme" tells a reader nothing about what pressing it will do.
 *
 * Three themes, not two: `system` is a real mode in `ThemeProvider`, and a switch
 * that offered only dark and light would make `system` undocumented on this site.
 *
 * ## `home-hero-after`, not a `Layout` swap
 *
 * VitePress resolves `layout: home` to its own `VPHome`, which draws a hero and a
 * feature grid out of front matter and has no slot that looks for a registered
 * `Home` component. Passing the component through the documented
 * `home-hero-after` slot keeps the nav, the footer and the outline, and `site/index.md`
 * sets `hero: false` so VitePress's own hero is not drawn above the evidence chain.
 */
const { theme, isDark } = useData();

type SiteTheme = 'dark' | 'light' | 'system';

const NEXT: Record<SiteTheme, SiteTheme> = {
  dark: 'light',
  light: 'system',
  system: 'dark',
};

const LABEL: Record<SiteTheme, string> = {
  dark: 'dark',
  light: 'light',
  system: 'your system setting',
};

const siteTheme = computed<SiteTheme>(() => {
  const value = theme.value;
  return value === 'light' || value === 'system' ? value : 'dark';
});

function apply(next: SiteTheme): void {
  if (next === 'system') {
    theme.value = 'auto';
    return;
  }
  theme.value = next;
}
</script>

<template>
  <DefaultTheme.Layout>
    <template #nav-bar-title-after>
      <button
        type="button"
        class="site-theme-toggle"
        data-testid="site-theme-toggle"
        :title="`Current theme: ${LABEL[siteTheme]}. Click to change.`"
        :aria-label="`Theme: ${LABEL[siteTheme]}. Switch to ${LABEL[NEXT[siteTheme]]}.`"
        @click="apply(NEXT[siteTheme])"
      >
        <span aria-hidden="true">{{
          siteTheme === 'light' ? 'Light' : siteTheme === 'system' ? 'Auto' : 'Dark'
        }}</span>
        <span class="site-theme-toggle__mark" aria-hidden="true">{{ isDark ? '●' : '○' }}</span>
      </button>
    </template>

    <template #home-hero-after>
      <Home />
    </template>
  </DefaultTheme.Layout>
</template>

<style scoped>
/*
 * Three tokens and a focus ring.
 *
 * Every colour here is a `var()` into the product's tokens, so the switch is on the
 * plane and reads as part of the chrome rather than as a widget dropped onto the
 * nav bar. There is no literal colour in this block, and `site-doctor` check 8 fails
 * if one appears.
 */
.site-theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: 0.75rem;
  padding: 0.2rem 0.5rem;
  font-family: var(--automate-font-mono);
  font-size: 0.75rem;
  color: var(--automate-fg-muted);
  background: transparent;
  border: 1px solid var(--automate-border);
  border-radius: 0.375rem;
  cursor: pointer;
  transition:
    color 150ms ease,
    border-color 150ms ease;
}

.site-theme-toggle:hover {
  color: var(--automate-fg);
  border-color: var(--automate-border-strong);
}

.site-theme-toggle:focus-visible {
  outline: 2px solid var(--automate-accent);
  outline-offset: 2px;
}

.site-theme-toggle__mark {
  font-size: 0.5rem;
  line-height: 1;
  color: var(--automate-accent);
}

.site-theme-toggle__mark--light {
  color: var(--automate-fg-muted);
}

/*
 * One media query, and it is the reduced-transparency hatch rather than
 * reduced-motion: this control has no animation of its own to switch off, but the
 * page behind it may gain some, and the border is the one thing here that carries
 * information.
 */
@media (prefers-reduced-transparency: reduce) {
  .site-theme-toggle {
    border-color: var(--automate-border-strong);
  }
}
</style>
