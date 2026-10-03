---
layout: home
hero: false
features: false
---

<!--
  The front page is a Vue component, and this file is its mount point.

  **The hero and the feature list that used to be in this front matter are now in
  `theme/Home.vue`**, which renders the evidence chain above them. Three reasons,
  all of them about what a front matter block cannot express:

  1. **The chain needs links, and front matter cannot make them.** Each of the six
     stages links to the page that documents it, and each one can be *not measured* —
     which has to be visible as its own state rather than as a missing number.
  2. **The numbers are readings, so they are set in the mono face** with tabular
     numerals. Front matter values are rendered into VitePress's own templates, and
     controlling the face per value is not something that API offers.
  3. **"not measured" is a state, not a value.** `RF-9` and `PERF-1` are open rows
     because no thresholds have been recorded. A front matter array cannot hold a
     null that renders differently from a zero, and rendering them as `0` would look
     complete — which is the one failure this page exists to be about.

  `site-doctor` check 8 asserts that this site's tokens are the product's tokens, so
  the palette here cannot drift from the one the console ships.
-->
