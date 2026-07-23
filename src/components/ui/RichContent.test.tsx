import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { sanitizeProjectRichText } from '../../utils/projectRichText'
import { RichContent } from './RichContent'

describe('project rich-content boundary', () => {
  it('keeps the small formatting allowlist', () => {
    render(
      <RichContent html="<h1>Vision</h1><h4>Purpose</h4><p><strong>Fund</strong> useful work.</p><ul><li>Open</li></ul>" />,
    )

    expect(screen.getByRole('heading', { name: 'Vision' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Purpose' })).toBeInTheDocument()
    expect(screen.getByText('Fund')).toHaveProperty('tagName', 'STRONG')
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('strips executable markup, event handlers, styles, and unsafe URLs', () => {
    const sanitized = sanitizeProjectRichText(`
      <script>alert(1)</script>
      <iframe src="https://attacker.example"></iframe><svg><circle></circle></svg>
      <math><mi>x</mi></math><form><input name="secret"></form>
      <audio src="bad"></audio><video src="bad"></video><embed src="bad">
      <p id="named" aria-label="bad" data-secret="bad" style="position:fixed" onclick="alert(2)">Safe text</p>
      <a href="javascript:alert(3)" target="_blank">bad link</a>
      <img src=x onerror="alert(4)">
    `)
    const container = document.createElement('div')
    container.innerHTML = sanitized

    expect(
      container.querySelector('script, iframe, img, svg, math, form, input, audio, video, embed'),
    ).toBeNull()
    expect(
      container.querySelector('[id], [aria-label], [data-secret], [style], [onclick], [onerror]'),
    ).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('bad link')
    expect(container.textContent).toContain('Safe text')
  })

  it('keeps only absolute HTTP(S) and mailto links and hardens each one', () => {
    render(
      <RichContent
        html={
          '<a href="https://example.com/docs" title="Details">HTTPS</a>' +
          '<a href="http://example.com/docs">HTTP</a>' +
          '<a href="mailto:hello@example.com">Email</a>' +
          '<a href="/project/1">Relative</a>' +
          '<a href="data:text/html,pwned">Data</a>'
        }
      />,
    )

    for (const label of ['HTTPS', 'HTTP', 'Email']) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('target', '_blank')
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('rel', 'noopener noreferrer')
    }
    expect(screen.getByRole('link', { name: 'HTTPS' })).toHaveAttribute('title', 'Details')
    expect(screen.queryByRole('link', { name: 'Relative' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Data' })).not.toBeInTheDocument()
    expect(document.body).toHaveTextContent('RelativeData')
  })

  it('preserves bare HTTP URL linkification from the previous plain-text view', () => {
    render(<RichContent html="Read https://example.com/project for details." />)

    expect(screen.getByRole('link', { name: 'https://example.com/project' }))
      .toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('caps attacker-controlled input before parsing', () => {
    const sanitized = sanitizeProjectRichText(`<p>${'a'.repeat(60_000)}</p>`)

    expect(sanitized.length).toBeLessThan(51_000)
    expect(sanitized).toMatch(/^<p>a+/)
  })
})
