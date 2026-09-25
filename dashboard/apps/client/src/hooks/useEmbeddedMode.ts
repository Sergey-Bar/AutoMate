import { useState, useEffect } from 'react'

export function useEmbeddedMode() {
  const [isEmbedded, setIsEmbedded] = useState(() => {
    try {
      return window.self !== window.top
    } catch {
      return true // cross-origin iframe
    }
  })

  // While checking inside useState handles the initial render (SSR/hydration safe if done right, 
  // though we are in a SPA here), keeping it in sync if needed (though it shouldn't change).
  return isEmbedded
}
