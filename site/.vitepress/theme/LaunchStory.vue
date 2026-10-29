<script setup lang="ts">
import { computed, ref } from 'vue';
import { useData, withBase } from 'vitepress';
const { lang } = useData();
const he = computed(() => lang.value === 'he');
const chapter = ref(0);
const scenario = ref(1);
const copy = computed(() =>
  he.value
    ? {
        title: 'אל תקראו על זה. נסו בעצמכם.',
        intro: 'שנו תוצאה אחת. גלו איך היא משנה את הסיפור.',
        steps: ['התוצאה', 'הראיות', 'ההחלטה'],
        options: ['עבר', 'עבר בניסיון חוזר', 'נכשל'],
        titles: ['תוצאה אחת. סיפור שלם.', 'כל ניסיון נשאר גלוי.', 'בהירות לפני השחרור.'],
        details: [
          'בחרו תרחיש וראו מה מסתתר מאחורי תוצאת הבדיקה.',
          'הצלחה בניסיון חוזר אינה מוחקת כישלון קודם.',
          'כללי האיכות שלכם קובעים מה חוסם שחרור. בדיקה אחת אינה מספיקה לאישור גרסה.',
        ],
        status: ['עבר בניסיון הראשון', 'עבר רק בניסיון השני', 'נכשל גם בניסיון החוזר'],
        verdict: [
          'הבדיקה עברה. ממשיכים לבדוק את שאר התנאים.',
          'התוצאה אינה עקבית. כדאי לחקור את הסיבה.',
          'יש כישלון שצריך לבדוק לפני שממשיכים.',
        ],
        demo: 'תרחיש להמחשה · אינו נתון חי',
        attempt: 'ניסיון',
        next: 'השלב הבא',
        again: 'בחזרה לתוצאה',
        docs: 'איך כללי האיכות עובדים',
        passed: 'עבר',
        failed: 'נכשל',
      }
    : {
        title: 'Don’t just read it. Try it.',
        intro: 'Change one result. See the whole story change.',
        steps: ['The result', 'The evidence', 'The decision'],
        options: ['Passed', 'Passed on retry', 'Failed'],
        titles: [
          'One result. A whole story.',
          'Every attempt stays visible.',
          'Clarity before you ship.',
        ],
        details: [
          'Choose a scenario to see what sits behind the test result.',
          'A later pass does not erase an earlier failure.',
          'Your quality policies determine what blocks a release. One test alone cannot approve it.',
        ],
        status: [
          'Passed on the first attempt',
          'Passed on the second attempt',
          'Still failing after a retry',
        ],
        verdict: [
          'This test passed. The remaining release checks still matter.',
          'An inconsistent result needs attention. Investigate the cause.',
          'A failure needs investigation before you move forward.',
        ],
        demo: 'ILLUSTRATIVE SCENARIO · NOT LIVE DATA',
        attempt: 'Attempt',
        next: 'Next chapter',
        again: 'Back to the result',
        docs: 'Explore quality gates',
        passed: 'Passed',
        failed: 'Failed',
      },
);
const attempts = computed(() => (scenario.value === 0 ? [true] : [false, scenario.value === 1]));
</script>
<template>
  <section class="story" :dir="he ? 'rtl' : 'ltr'" aria-labelledby="story-title">
    <header>
      <p class="eyebrow">{{ he ? 'מבדיקה להחלטה' : 'FROM SIGNAL TO DECISION' }}</p>
      <h2 id="story-title">{{ copy.title }}</h2>
      <p>{{ copy.intro }}</p>
    </header>
    <div class="chapters" role="group" :aria-label="he ? 'שלבי ההדגמה' : 'Demo chapters'">
      <button
        v-for="(step, index) in copy.steps"
        :key="index"
        type="button"
        :aria-pressed="chapter === index"
        @click="chapter = index"
      >
        <span>0{{ index + 1 }}</span
        >{{ step }}
      </button>
    </div>
    <div class="stage">
      <div class="narrative">
        <span class="number" aria-hidden="true">0{{ chapter + 1 }}</span>
        <h3>{{ copy.titles[chapter] }}</h3>
        <p>{{ copy.details[chapter] }}</p>
        <button class="next" type="button" @click="chapter = (chapter + 1) % 3">
          {{ chapter === 2 ? copy.again : copy.next }} {{ he ? '←' : '→' }}
        </button>
      </div>
      <div class="demo">
        <p class="eyebrow">{{ copy.demo }}</p>
        <div class="scenarios" role="group" :aria-label="he ? 'תוצאת בדיקה' : 'Test outcome'">
          <button
            v-for="(option, index) in copy.options"
            :key="index"
            type="button"
            :aria-pressed="scenario === index"
            @click="scenario = index"
          >
            {{ option }}
          </button>
        </div>
        <Transition name="frame" mode="out-in"
          ><div
            :key="`${chapter}-${scenario}`"
            :class="['frame', ['passed', 'retry', 'failed'][scenario]]"
            aria-live="polite"
            aria-atomic="true"
          >
            <p class="filename" dir="ltr">checkout.spec.ts</p>
            <svg class="signal-path" viewBox="0 0 400 64" fill="none" aria-hidden="true">
              <path class="signal-track" d="M24 32H376" />
              <path class="signal-line" d="M24 32H184L200 12L216 52L232 32H376" />
              <circle cx="24" cy="32" r="6" fill="currentColor" />
              <circle cx="376" cy="32" r="9" fill="currentColor" />
            </svg>
            <template v-if="chapter === 0"
              ><span class="symbol" aria-hidden="true">{{ ['✓', '↻', '×'][scenario] }}</span>
              <h4>{{ copy.status[scenario] }}</h4></template
            >
            <div v-else-if="chapter === 1" class="attempts">
              <div v-for="(passed, index) in attempts" :key="index">
                <span>{{ copy.attempt }} 0{{ index + 1 }}</span
                ><strong :class="passed ? 'passed' : 'failed'"
                  >{{ passed ? '✓' : '×' }} {{ passed ? copy.passed : copy.failed }}</strong
                >
              </div>
            </div>
            <template v-else
              ><span class="symbol" aria-hidden="true">◎</span>
              <h4>{{ copy.verdict[scenario] }}</h4>
              <a :href="withBase('/guide/quality-gates')">{{ copy.docs }} ↗</a></template
            >
          </div></Transition
        >
      </div>
    </div>
  </section>
</template>
<style scoped>
.story {
  margin-block: clamp(4rem, 8vw, 8rem);
  text-align: start;
}
header {
  max-width: 48rem;
  margin: 0 auto 2.5rem;
  text-align: center;
}
.eyebrow {
  font-size: 0.7rem;
  color: var(--automate-fg-muted);
  letter-spacing: 0.08em;
  line-height: 1.6;
}
h2 {
  font-size: clamp(2rem, 4.5vw, 4.5rem);
  line-height: 1.12;
  text-wrap: balance;
  margin-block: 1rem;
  font-weight: 650;
}
header > p:last-child {
  color: var(--automate-fg-muted);
  font-size: 1.125rem;
  line-height: 1.7;
}
.chapters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-block-end: 1px solid var(--automate-border);
}
.chapters button {
  padding: 1.25rem 0.5rem;
  color: var(--automate-fg-muted);
  border-block-end: 2px solid transparent;
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  cursor: pointer;
}
.chapters button[aria-pressed='true'] {
  color: var(--automate-fg);
  border-color: var(--automate-fg);
}
.chapters span {
  font: 0.75rem var(--automate-font-mono);
}
.stage {
  display: grid;
  grid-template-columns: 0.85fr 1.15fr;
  border: 1px solid var(--automate-border);
  border-block-start: 0;
  background: var(--automate-surface);
  border-radius: 0 0 16px 16px;
  overflow: hidden;
}
.narrative {
  padding: clamp(1.5rem, 4vw, 4rem);
  align-self: center;
}
.number {
  font: clamp(3rem, 6vw, 6rem) var(--automate-font-mono);
  color: var(--automate-fg-muted);
}
h3 {
  font-size: clamp(1.5rem, 2.5vw, 2.5rem);
  line-height: 1.2;
  text-wrap: balance;
  margin-block: 1rem;
}
.narrative p {
  color: var(--automate-fg-muted);
  line-height: 1.8;
  max-width: 34ch;
}
.next {
  margin-block-start: 1.5rem;
  padding-block: 0.75rem;
  cursor: pointer;
  font-weight: 600;
}
.demo {
  min-width: 0;
  padding: clamp(1.25rem, 3vw, 3rem);
  background: var(--automate-surface-raised);
  border-inline-start: 1px solid var(--automate-border);
}
.scenarios {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block: 1.5rem;
}
.scenarios button {
  border: 1px solid var(--automate-border);
  border-radius: 6px;
  padding: 0.65rem 0.85rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.scenarios button[aria-pressed='true'] {
  background: var(--automate-fg);
  color: var(--automate-surface);
}
.frame {
  min-height: 17rem;
}
.filename {
  font: 0.8rem var(--automate-font-mono);
  color: var(--automate-fg-muted);
  padding-block: 1rem;
  border-block-end: 1px solid var(--automate-border);
}
.symbol {
  font-size: 3.5rem;
  line-height: 1.2;
  display: block;
  margin-block-start: 1.5rem;
}
h4 {
  font-size: clamp(1.25rem, 2vw, 1.75rem);
  line-height: 1.45;
  margin-block: 0.75rem;
  text-wrap: balance;
}
.frame a {
  display: inline-block;
  margin-block-start: 0.75rem;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.attempts > div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 1.5rem;
  border-block-end: 1px solid var(--automate-border);
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--automate-fg);
  outline-offset: 4px;
}
.frame-enter-active,
.frame-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.frame-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.frame-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (max-width: 700px) {
  .stage {
    grid-template-columns: 1fr;
  }
  .demo {
    border-inline-start: 0;
    border-block-start: 1px solid var(--automate-border);
  }
  .number {
    display: none;
  }
  .chapters button {
    font-size: 0.85rem;
    flex-direction: column;
    gap: 0.25rem;
  }
  .narrative p {
    max-width: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .frame-enter-active,
  .frame-leave-active {
    transition: none;
  }
}
.passed {
  --signal-color: var(--automate-success);
}
.retry {
  --signal-color: var(--automate-warning);
}
.failed {
  --signal-color: var(--automate-danger);
}
.symbol,
.attempts strong {
  color: var(--signal-color);
}
.signal-path {
  width: 100%;
  height: 64px;
  margin-block-start: 1rem;
  color: var(--signal-color);
}
.signal-track {
  stroke: var(--automate-border);
  stroke-width: 1;
}
.signal-line {
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
</style>
