---
title: Words explained
description: Plain-language definitions and concrete examples for the terms used across Automate.
---

# Words explained

You do not need to learn the whole vocabulary before using Automate. Start with the word
on the screen you are looking at.

<div class="guide-hub">
  <div class="guide-hub__card"><span>RUN</span><strong>One recorded execution</strong><small>A run brings together the tests, their results and the evidence produced by that execution. Example: your checkout suite on the latest commit.</small></div>
  <div class="guide-hub__card"><span>TEST</span><strong>One behavior being checked</strong><small>A test checks a particular behavior. Example: whether a customer can apply a coupon at checkout.</small></div>
  <div class="guide-hub__card"><span>PHASE</span><strong>Where the run is now</strong><small>Queued, running and collecting describe progress. A run can still be collecting files after a test has failed.</small></div>
  <div class="guide-hub__card"><span>OUTCOME</span><strong>What happened</strong><small>Passed, failed and unknown describe the result. Unknown means there is not enough usable information to call it a pass.</small></div>
  <div class="guide-hub__card"><span>RETRY</span><strong>Trying a test again</strong><small>A test can fail on its first attempt and pass on its next. The earlier failure remains important.</small></div>
  <div class="guide-hub__card"><span>FLAKY</span><strong>Passed after a failure</strong><small>Within a run, a test that fails and then passes on retry is flaky. It is different from passing first time.</small></div>
  <div class="guide-hub__card"><span>ARTIFACT</span><strong>A file that explains a result</strong><small>A report, screenshot or trace retained with a run. Open the available artifacts when you need more context.</small></div>
  <div class="guide-hub__card"><span>QUALITY GATE</span><strong>A decision using agreed rules</strong><small>A policy evaluates the available evidence against thresholds. The resulting verdict explains whether the policy was satisfied.</small></div>
  <div class="guide-hub__card"><span>QUARANTINE</span><strong>A recorded exception for an unstable test</strong><small>A proposal needs a reason and a decision. Pending proposals still count; approved tests remain visible.</small></div>
  <div class="guide-hub__card"><span>RUNNER</span><strong>The process that does the work</strong><small>A runner claims an execution job and runs it. A lost runner is an infrastructure problem, not automatically a failed test.</small></div>
  <div class="guide-hub__card"><span>CI</span><strong>Automation around a code change</strong><small>Your CI job can run tests and send their reports to Automate. You can keep your existing test framework.</small></div>
  <div class="guide-hub__card"><span>NOT CONFIGURED</span><strong>No setup for this signal</strong><small>The installation has not configured the capability needed to collect that signal. It does not mean the check passed.</small></div>
</div>

## See the difference for yourself

<RunExplainer />

## Choose your next step

- [Explore a run visually](concepts.md).
- [Send your first report](sending-results.md).
- [Learn how release decisions work](quality-gates.md).
- [Choose a guided path for your role](index.md).
