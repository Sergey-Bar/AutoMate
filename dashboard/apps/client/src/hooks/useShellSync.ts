import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'

export function useShellSync(isEmbedded: boolean) {
  const router = useRouter()

  useEffect(() => {
    if (!isEmbedded) return

    // Send route changes to parent
    const unsubscribe = router.subscribe('onResolved', (event) => {
      window.parent.postMessage(
        { type: 'route-change', path: event.toLocation.pathname },
        window.location.origin
      )
    })

    // Listen for navigation commands from parent shell
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      
      if (event.data?.type === 'navigate' && typeof event.data.path === 'string') {
        router.navigate({ to: event.data.path })
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      unsubscribe()
      window.removeEventListener('message', handleMessage)
    }
  }, [isEmbedded, router])
}
