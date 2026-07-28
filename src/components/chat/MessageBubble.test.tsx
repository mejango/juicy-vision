import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MessageBubble from './MessageBubble'

vi.mock('../../stores', () => ({
  useThemeStore: () => ({ theme: 'light' }),
  useSettingsStore: () => ({ selectedFruit: 'orange' }),
}))

vi.mock('../../services/siwe', () => ({
  getWalletSession: () => null,
}))

vi.mock('../../services/session', () => ({
  getSessionId: () => 'session-id',
  getCachedPseudoAddress: () => null,
  getPseudoAddress: () => '0x0000000000000000000000000000000000000001',
}))

vi.mock('../dynamic/ComponentRegistry', () => ({
  default: ({ isStreaming }: { isStreaming?: boolean }) => (
    <div data-testid="component-registry" data-streaming={String(isStreaming)} />
  ),
}))

vi.mock('./ThinkingIndicator', () => ({
  default: () => <div data-testid="thinking-indicator" />,
}))

vi.mock('./ParticipantAvatars', () => ({
  getEmojiForUser: () => '🍊',
  MemberPopover: () => null,
}))

vi.mock('./WalletInfo', () => ({
  JuicyIdPopover: () => null,
}))

describe('MessageBubble markdown safety', () => {
  it('renders hostile raw HTML as inert text without creating executable elements', () => {
    const payload = [
      '<script>window.__juicyXss = true</script>',
      '<img src=x onerror="window.__juicyXss = true">',
      '<iframe srcdoc="<script>window.__juicyXss = true</script>"></iframe>',
    ].join('\n\n')

    const { container } = render(
      <MessageBubble
        message={{
          id: 'hostile-markdown',
          role: 'assistant',
          content: payload,
        }}
      />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.textContent).toContain('<script>')
    expect(container.textContent).toContain('<img src=x onerror=')
    expect(container.textContent).toContain('<iframe srcdoc=')
  })
})

describe('MessageBubble component streaming signal', () => {
  // A truncated component tag (stream died mid-array) stays isStreaming in the
  // parser forever — the registry needs the MESSAGE-level flag to know the
  // stream actually ended, or pickers grey out as "Loading..." permanently.
  const truncatedContent =
    'Pick one:\n\n<juice-component type="options-picker" groups=\'[{"id":"a"'

  it('threads message.isStreaming=false into ComponentRegistry when the stream ended', () => {
    render(
      <MessageBubble
        message={{
          id: 'truncated-done',
          role: 'assistant',
          content: truncatedContent,
          isStreaming: false,
        }}
      />,
    )

    expect(screen.getByTestId('component-registry')).toHaveAttribute('data-streaming', 'false')
  })

  it('threads message.isStreaming=true into ComponentRegistry while streaming', () => {
    render(
      <MessageBubble
        message={{
          id: 'truncated-live',
          role: 'assistant',
          content: truncatedContent,
          isStreaming: true,
        }}
      />,
    )

    expect(screen.getByTestId('component-registry')).toHaveAttribute('data-streaming', 'true')
  })
})
