import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import GuideStoryboard from './GuideStoryboard.vue';
import RunExplainer from './RunExplainer.vue';
import StartHere from './StartHere.vue';
import './custom.css';
import './lupin.css';

/** Keep VitePress routing, search, and documentation; layer the public-site identity on top. */
export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('GuideStoryboard', GuideStoryboard);
    app.component('RunExplainer', RunExplainer);
    app.component('StartHere', StartHere);
  },
} satisfies Theme;
