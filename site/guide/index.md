---
title: Guide
description: Getting the stack up, sending results, and how the repository tests and maintains itself.
---

# Guide

Read these in order the first time. Each page links the code it describes.

| Page                                                    | What it is for                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Getting started](getting-started.md)                   | `pnpm install`, the API, the web console, and the database                                        |
| [Core concepts](concepts.md)                            | Runs, attempts, results and evidence — and why a run is a chain rather than a green tick          |
| [Sending results](sending-results.md)                   | Upload a Playwright, JUnit, k6 or ZAP report from any CI job                                      |
| [Quality gates and quarantine](quality-gates.md)        | How a run is judged, and how a flaky test is set aside without being hidden                       |
| [How this repository tests itself](testing-strategy.md) | The test layers, the gate chain, and the rules that keep a green suite honest                     |
| [How this project is maintained](maintenance.md)        | The findings ledger, dependency policy, review passes and the cadence                             |
| [The design language](design-language.md)               | The plane, the accent, the type, the motion, the escape hatches, and why `info` is not the accent |

::: info This section is the only place the palette is written down
The product's own tokens are in `packages/ui/src/tokens/theme.css`, and every number on
the design-language page has an assertion behind it. This section does not restate them
authoritatively — it explains why they are the numbers they are, which is the part a
table of hex values cannot carry.
:::
