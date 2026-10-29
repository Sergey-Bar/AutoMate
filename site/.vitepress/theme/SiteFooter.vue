<script setup lang="ts">
import { withBase } from 'vitepress';
import { githubUrl } from '../locales';
</script>
<template>
  <footer class="lupin-footer">
    <div>
      <a class="lupin-wordmark" :href="withBase('/')">Lupin<span aria-hidden="true">.</span></a>
      <p>Observe. Investigate. Decide.</p>
      <small>© 2026 Automate Platform Contributors</small>
    </div>
    <nav aria-label="Footer">
      <a :href="withBase('/guide/')">Documentation</a><a :href="githubUrl">GitHub</a
      ><a :href="`${githubUrl}/releases`">Releases</a
      ><a :href="`${githubUrl}/blob/main/.github/CONTRIBUTING.md`">Contributing</a
      ><a :href="`${githubUrl}/blob/main/LICENSE`">MIT license</a>
    </nav>
  </footer>
</template>
