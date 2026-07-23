import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RegisterSWOptions = {
  onNeedRefresh: () => void
  onOfflineReady: () => void
}

const bootstrap = vi.hoisted(() => {
  const render = vi.fn()
  const updateSW = vi.fn()

  return {
    createRoot: vi.fn(() => ({ render })),
    registerSW: vi.fn((_options: RegisterSWOptions) => updateSW),
    render,
    updateSW,
  }
})

vi.mock('react-dom/client', () => ({
  createRoot: bootstrap.createRoot,
}))

vi.mock('virtual:pwa-register', () => ({
  registerSW: bootstrap.registerSW,
}))

vi.mock('./App', () => ({
  default: () => null,
}))

vi.mock('./i18n', () => ({}))

describe('application bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="root"></div>'
    bootstrap.createRoot.mockClear()
    bootstrap.registerSW.mockClear()
    bootstrap.render.mockClear()
    bootstrap.updateSW.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('mounts the app and registers the service worker callbacks', async () => {
    const confirmReload = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await import('./main')

    expect(bootstrap.createRoot).toHaveBeenCalledWith(document.getElementById('root'))
    expect(bootstrap.render).toHaveBeenCalledOnce()
    expect(bootstrap.registerSW).toHaveBeenCalledOnce()

    const options = bootstrap.registerSW.mock.calls[0]?.[0]
    if (!options) throw new Error('Expected service worker registration options')

    options.onNeedRefresh()
    expect(bootstrap.updateSW).not.toHaveBeenCalled()

    confirmReload.mockReturnValue(true)
    options.onNeedRefresh()
    expect(bootstrap.updateSW).toHaveBeenCalledWith(true)

    options.onOfflineReady()
    expect(log).toHaveBeenCalledWith('App ready for offline use')
  })
})
