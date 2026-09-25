import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useShellSync } from './useShellSync'
import { useRouter } from '@tanstack/react-router'

vi.mock('@tanstack/react-router', () => ({
  useRouter: vi.fn(),
}))

describe('useShellSync', () => {
  let routerMock: any
  let originalWindow: Window

  beforeEach(() => {
    originalWindow = window
    
    routerMock = {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      navigate: vi.fn()
    }
    
    vi.mocked(useRouter).mockReturnValue(routerMock)
    
    vi.spyOn(window.parent, 'postMessage')
    vi.spyOn(window, 'addEventListener')
    vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing if not embedded', () => {
    renderHook(() => useShellSync(false))
    
    expect(routerMock.subscribe).not.toHaveBeenCalled()
    expect(window.addEventListener).not.toHaveBeenCalled()
  })

  it('subscribes to router and listens to messages when embedded', () => {
    const { unmount } = renderHook(() => useShellSync(true))
    
    expect(routerMock.subscribe).toHaveBeenCalledWith('onResolved', expect.any(Function))
    expect(window.addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    
    unmount()
    expect(window.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function))
  })

  it('posts message on route change', () => {
    renderHook(() => useShellSync(true))
    
    const subscribeCallback = routerMock.subscribe.mock.calls[0][1]
    
    // Simulate route change
    subscribeCallback({ toLocation: { pathname: '/runs' } })
    
    expect(window.parent.postMessage).toHaveBeenCalledWith(
      { type: 'route-change', path: '/runs' },
      window.location.origin
    )
  })

  it('navigates on valid message', () => {
    renderHook(() => useShellSync(true))
    
    const messageHandler = vi.mocked(window.addEventListener).mock.calls.find(
      (call) => call[0] === 'message'
    )?.[1] as EventListener
    
    // Valid message
    messageHandler({
      origin: window.location.origin,
      data: { type: 'navigate', path: '/tests' }
    } as MessageEvent)
    
    expect(routerMock.navigate).toHaveBeenCalledWith({ to: '/tests' })
  })

  it('ignores messages from other origins', () => {
    renderHook(() => useShellSync(true))
    
    const messageHandler = vi.mocked(window.addEventListener).mock.calls.find(
      (call) => call[0] === 'message'
    )?.[1] as EventListener
    
    messageHandler({
      origin: 'https://evil.com',
      data: { type: 'navigate', path: '/tests' }
    } as MessageEvent)
    
    expect(routerMock.navigate).not.toHaveBeenCalled()
  })

  it('ignores invalid message types', () => {
    renderHook(() => useShellSync(true))
    
    const messageHandler = vi.mocked(window.addEventListener).mock.calls.find(
      (call) => call[0] === 'message'
    )?.[1] as EventListener
    
    messageHandler({
      origin: window.location.origin,
      data: { type: 'other', path: '/tests' }
    } as MessageEvent)
    
    expect(routerMock.navigate).not.toHaveBeenCalled()
  })
})
