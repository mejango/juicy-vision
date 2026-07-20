import { describe, it, expect } from 'vitest'
import { parseMessageContent, stripComponents } from './messageParser'

describe('messageParser', () => {
  describe('parseMessageContent', () => {
    describe('component tag formats', () => {
      it('parses juice-component tags', () => {
        const content = 'Hello <juice-component type="project-card" projectId="123" chainId="1" />'
        const result = parseMessageContent(content)

        expect(result.segments).toHaveLength(2)
        expect(result.segments[0].type).toBe('text')
        expect((result.segments[0] as { type: 'text'; content: string }).content.trim()).toBe('Hello')
        expect(result.segments[1]).toEqual({
          type: 'component',
          component: {
            type: 'project-card',
            props: { projectId: '123', chainId: '1' },
            raw: '<juice-component type="project-card" projectId="123" chainId="1" />',
          },
        })
      })

      it('parses short <component> tags (AI sometimes uses this format)', () => {
        const content = 'Hello <component type="project-card" projectId="123" chainId="1" />'
        const result = parseMessageContent(content)

        expect(result.segments).toHaveLength(2)
        expect(result.segments[0].type).toBe('text')
        expect((result.segments[0] as { type: 'text'; content: string }).content.trim()).toBe('Hello')
        expect(result.segments[1]).toEqual({
          type: 'component',
          component: {
            type: 'project-card',
            props: { projectId: '123', chainId: '1' },
            raw: '<component type="project-card" projectId="123" chainId="1" />',
          },
        })
      })

      it('handles multi-line component tags with JSON parameters', () => {
        const content = `Choose a route. <component type="options-picker" groups='[
  {"id": "route", "label": "Route", "options": [{"value": "direct", "label": "Direct"}]}
]' submitLabel="Continue" />

Then continue.`

        const result = parseMessageContent(content)

        expect(result.segments).toHaveLength(3)
        expect(result.segments[0].type).toBe('text')
        expect(result.segments[1].type).toBe('component')
        expect((result.segments[1] as { type: 'component'; component: { type: string } }).component.type).toBe('options-picker')
        expect(result.segments[2].type).toBe('text')
      })
    })

    describe('streaming partial tags', () => {
      it('detects partial juice-component tag during streaming', () => {
        const content = 'Choose one... <juice-component type="options-picker" groups=\'[{"id":"route"'
        const result = parseMessageContent(content)

        // Should show the text and a streaming component
        expect(result.segments.length).toBeGreaterThanOrEqual(2)
        const lastSegment = result.segments[result.segments.length - 1]
        expect(lastSegment.type).toBe('component')
        expect((lastSegment as { type: 'component'; component: { isStreaming?: boolean } }).component.isStreaming).toBe(true)
      })

      it('detects partial <component> tag during streaming', () => {
        const content = 'Choose one... <component type="options-picker" groups=\'[{"id":"route"'
        const result = parseMessageContent(content)

        // Should show the text and a streaming component
        expect(result.segments.length).toBeGreaterThanOrEqual(2)
        const lastSegment = result.segments[result.segments.length - 1]
        expect(lastSegment.type).toBe('component')
        expect((lastSegment as { type: 'component'; component: { isStreaming?: boolean } }).component.isStreaming).toBe(true)
      })
    })

    describe('single quoted JSON attributes', () => {
      it('parses single-quoted JSON with nested objects', () => {
        const content = `<juice-component type="options-picker" groups='[{"id":"route","options":[{"value":"direct"}]}]' />`
        const result = parseMessageContent(content)

        expect(result.segments).toHaveLength(1)
        expect(result.segments[0].type).toBe('component')
        const component = (result.segments[0] as { type: 'component'; component: { props: Record<string, string> } }).component
        expect(component.props.groups).toBe('[{"id":"route","options":[{"value":"direct"}]}]')
      })
    })
  })

  describe('stripComponents', () => {
    it('strips juice-component tags', () => {
      const content = 'Hello <juice-component type="project-card" projectId="123" /> world'
      const result = stripComponents(content)
      expect(result).toBe('Hello [Project card with payment form] world')
    })

    it('strips short <component> tags', () => {
      const content = 'Hello <component type="project-card" projectId="123" /> world'
      const result = stripComponents(content)
      expect(result).toBe('Hello [Project card with payment form] world')
    })
  })
})
