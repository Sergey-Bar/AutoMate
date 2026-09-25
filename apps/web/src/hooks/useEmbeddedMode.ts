import { useState } from 'react';

export function useEmbeddedMode() {
  const [isEmbedded] = useState(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true; // Cross-origin iframe causes DOMException when accessing window.top
    }
  });
  return isEmbedded;
}
