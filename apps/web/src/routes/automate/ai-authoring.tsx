import React from 'react';
import { NLTestGenerator } from '../components/automate/NLTestGenerator.js';

export function AIAuthoringPage() {
  return (
    <section style={{ maxWidth: 1200, margin: '0 auto', padding: 24, height: '100%' }}>
      <h1 style={{ marginBottom: 8 }}>AI Test Authoring</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Describe a test scenario in plain English and let AI generate a Playwright test for you.
      </p>
      <NLTestGenerator />
    </section>
  );
}

export default AIAuthoringPage;
