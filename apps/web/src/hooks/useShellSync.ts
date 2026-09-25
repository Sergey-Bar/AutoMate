import { useEffect, useRef } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';

export function useShellSync(isEmbedded: boolean) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const lastSentPathRef = useRef<string>('');

  // Send route changes to shell
  useEffect(() => {
    if (!isEmbedded) return;
    
    const currentPath = location.href;
    if (currentPath !== lastSentPathRef.current) {
      lastSentPathRef.current = currentPath;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          { type: 'route-change', path: currentPath },
          window.location.origin
        );
      }
    }
  }, [location.href, isEmbedded]);

  // Receive navigation commands from shell
  useEffect(() => {
    if (!isEmbedded) return;

    const handleMessage = (event: MessageEvent) => {
      // Security: Only accept messages from same origin
      if (event.origin !== window.location.origin) return;

      const data = event.data;
      if (data && data.type === 'navigate' && typeof data.path === 'string') {
        const currentPath = location.href;
        if (currentPath !== data.path) {
          lastSentPathRef.current = data.path; // prevent echo
          navigate({ to: data.path });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isEmbedded, navigate, location.href]);
}
