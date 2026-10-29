# Lupin public-site design system

Lupin is the public-facing identity. The console, repository, CLI, packages, release filenames, configuration keys, and license attribution retain their current names. This is not a runtime migration.

## Identity and layout

Use the wordmark Lupin and the primary line “Know what broke. Know whether to ship.” The secondary line is “Observe. Investigate. Decide.” Content is evidence-led: explain what is implemented, link to its guide, and avoid promises about future intelligence features.

The content width is 1248px, with 32px desktop and 24px mobile gutters. Sections use 96px desktop / 64px mobile spacing on an 8px foundation. Buttons are 44px high; radii are 6–8px. Borders group content; shadows, particles, decorative dashboards, and entrance sequences are absent.

## Tokens and themes

`theme/lupin.css` owns the website palette and maps it onto the imported product semantic foundation and VitePress variables. This is an explicit site-only exception to the earlier shared-palette identity, requested by the Lupin brief. The product token files remain unchanged. Existing guide components inherit the website palette through aliases instead of maintaining copied component colors.

| Role           | Light   | Dark    |
| -------------- | ------- | ------- |
| Canvas         | #FAFAF9 | #101114 |
| Surface        | #FFFFFF | #191A1F |
| Text           | #15161A | #F4F4F6 |
| Secondary text | #6B6D76 | #A0A2AC |
| Border         | #E7E7E8 | #2D2F36 |
| Accent         | #6754AE | #B0A1EA |
| Soft accent    | #F0ECF8 | #242030 |

Violet is for links, primary actions, and selected emphasis, never a large decorative plane. Neutral borders are decorative; controls use a stronger edge and a visible focus ring. Semantic test-status colors remain semantic.

Light is the first-visit default. `lupin-site-theme` stores an explicit light/dark/system choice separately from the old brand and application. A small prepaint initializer and the Vue shell apply the same rules. Storage failures fall back to a usable local preference. All modes remain available through the compact keyboard-operable theme button.

## Typography

Self-hosted Geist Sans and Geist Mono variable WOFF2 files are pinned to an upstream commit in `public/fonts/manifest.json`, with SHA-256 hashes and the SIL Open Font License. There are no runtime font-service requests. Font display uses swap; explicit image dimensions and stable section structures reserve space. System fallbacks cover scripts missing from the font. Hero type is 38–76px, section type 30–48px, body 16–18px, technical labels 12–13px. Avoid uppercase paragraphs and excess weight changes.

## Product imagery and claims

`docs/assets/runs.png` is an authentic existing application screenshot. It is labelled as retaining AutoMate branding. Do not paint Lupin labels over it or fabricate new dashboard screens. A replacement screenshot is future work after a separate application-branding change. Only one screenshot is available; the site does not imply that invented screenshots exist for other views.

Integration types are explicit: Playwright live reporter and JSON import; JUnit XML import; k6 summary JSON; ZAP XML; Allure results import. Installation uses the actual release scripts (`./start.sh` and `.\start.cmd`) and existing repository links.

## Accessibility and motion

Semantic sections, one page h1, descriptive image alt, native links/buttons, existing keyboard-accessible language dialog, visible focus states, and responsive layouts are retained. Color never replaces a written outcome. The homepage requires no client animation state. Hover transitions are 150ms and disabled with reduced motion. Existing technical-guide interactions remain available.

## Verification and follow-up

Run the documentation typecheck/build, site doctor with `SITE_DOCTOR_BUILT=1`, `node --test site/tests/lupin-design.test.mjs`, and existing site-guidance tests. Site doctor still verifies the imported shared foundation; the Lupin-specific tests additionally validate the site palette, text contrast, and pinned font assets.

Production Core Web Vitals and a full assistive-technology audit need measurements on a deployed site; a successful build is not evidence of those results. Remaining brand work outside this scope: application screenshots, application name, runtime/package/CLI names, and any legal attribution change. Localized landing pages retain their existing translations; the new complete marketing narrative is English-first. Technical instructions deliberately retain executable AutoMate identifiers.
