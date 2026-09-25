import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useEmbeddedMode } from './useEmbeddedMode'

describe('useEmbeddedMode', () => {
  let originalWindow: Window

  beforeEach(() => {
    // Save original window
    originalWindow = window
  })

  afterEach(() => {
    // Restore original window
    vi.restoreAllMocks()
  })

  it('returns false when standalone (self === top)', () => {
    const mockWindow = { self: {}, top: {} }
    mockWindow.top = mockWindow.self
    
    vi.stubGlobal('window', mockWindow)
    
    const { result } = renderHook(() => useEmbeddedMode())
    expect(result.current).toBe(false)
  })

  it('returns true when embedded (self !== top)', () => {
    const mockWindow = { self: {}, top: {} }
    
    vi.stubGlobal('window', mockWindow)
    
    const { result } = renderHook(() => useEmbeddedMode())
    expect(result.current).toBe(true)
  })

  it('returns true on cross-origin access error', () => {
    const mockWindow = { 
      self: {},
      get top() {
        throw new Error('Blocked a frame with origin')
      }
    }
    
    vi.stubGlobal('window', mockWindow)
    
    const { result } = renderHook(() => useEmbeddedMode())
    expect(result.current).toBe(true)
  })
})
