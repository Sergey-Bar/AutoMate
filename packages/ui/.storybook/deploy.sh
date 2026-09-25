#!/bin/bash

# Build Storybook
pnpm --filter @automate/ui storybook:build

# Initialize a temporary git repository in the build output directory
cd packages/ui/storybook-static
git init
git add .
git commit -m "Deploy Storybook to GitHub Pages"

# Push to the gh-pages branch (force push to overwrite previous history)
# Note: Replace <repo-url> with the actual repository URL in your environment
# git push -f <repo-url> master:gh-pages

echo "Storybook build complete. Ready for deployment to gh-pages branch."
