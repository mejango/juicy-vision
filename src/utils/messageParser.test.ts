import { describe, it, expect } from 'vitest'
import { parseMessageContent, stripComponents, extractComponents } from './messageParser'

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
        const content = `I'll create a project. <component type="transaction-preview" action="launchProject" parameters='{
  "projectUri": "ipfs://test",
  "memo": "Test project"
}' explanation="Launch project" />

This will create your project.`

        const result = parseMessageContent(content)

        expect(result.segments).toHaveLength(3)
        expect(result.segments[0].type).toBe('text')
        expect(result.segments[1].type).toBe('component')
        expect((result.segments[1] as { type: 'component'; component: { type: string } }).component.type).toBe('transaction-preview')
        expect(result.segments[2].type).toBe('text')
      })
    })

    describe('streaming partial tags', () => {
      it('detects partial juice-component tag during streaming', () => {
        const content = 'Creating project... <juice-component type="transaction-preview" action="launchProject" parameters=\'{ "projectUri": "ipfs://test'
        const result = parseMessageContent(content)

        // Should show the text and a streaming component
        expect(result.segments.length).toBeGreaterThanOrEqual(2)
        const lastSegment = result.segments[result.segments.length - 1]
        expect(lastSegment.type).toBe('component')
        expect((lastSegment as { type: 'component'; component: { isStreaming?: boolean } }).component.isStreaming).toBe(true)
      })

      it('detects partial <component> tag during streaming', () => {
        const content = 'Creating project... <component type="transaction-preview" action="launchProject" parameters=\'{ "projectUri": "ipfs://test'
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
        const content = `<juice-component type="transaction-preview" action="launchProject" parameters='{"rulesetConfigurations": [{"mustStartAtOrAfter": 0}]}' />`
        const result = parseMessageContent(content)

        expect(result.segments).toHaveLength(1)
        expect(result.segments[0].type).toBe('component')
        const component = (result.segments[0] as { type: 'component'; component: { props: Record<string, string> } }).component
        expect(component.props.parameters).toBe('{"rulesetConfigurations": [{"mustStartAtOrAfter": 0}]}')
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

  describe('extractComponents', () => {
    it('extracts juice-component tags', () => {
      const content = 'Text <juice-component type="project-card" projectId="1" /> more <juice-component type="balance-chart" projectId="2" />'
      const result = extractComponents(content)

      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('project-card')
      expect(result[1].type).toBe('balance-chart')
    })

    it('extracts short <component> tags', () => {
      const content = 'Text <component type="project-card" projectId="1" /> more <component type="balance-chart" projectId="2" />'
      const result = extractComponents(content)

      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('project-card')
      expect(result[1].type).toBe('balance-chart')
    })

    it('extracts mixed format tags', () => {
      const content = 'Text <juice-component type="project-card" projectId="1" /> more <component type="balance-chart" projectId="2" />'
      const result = extractComponents(content)

      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('project-card')
      expect(result[1].type).toBe('balance-chart')
    })
  })
})
