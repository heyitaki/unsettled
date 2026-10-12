import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const attr = (pattern: RegExp): string => html.match(pattern)?.[1] ?? ''

// The site serves the app at this exact URL; the trailing-slash form is a 404.
const CANONICAL = 'https://akshath.me/unsettled'

describe('page metadata', () => {
  it('points every search and preview URL at the served page', () => {
    expect(attr(/<link rel="canonical" href="([^"]*)"/)).toBe(CANONICAL)
    expect(attr(/<meta property="og:url" content="([^"]*)"/)).toBe(CANONICAL)
    const image = attr(/<meta property="og:image" content="([^"]*)"/)
    expect(image).toBe(`${CANONICAL}/og.png`)
    expect(existsSync('public/og.png')).toBe(true)

    const data: unknown = JSON.parse(attr(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/))
    expect(data).toMatchObject({ '@type': 'WebApplication', url: CANONICAL, screenshot: image })
  })

  it('keeps the title and description within what a result page shows', () => {
    const title = attr(/<title>([^<]*)<\/title>/)
    expect(title).toContain('Catan Analyzer')
    expect(title.length).toBeLessThanOrEqual(60)
    const description = attr(/<meta name="description" content="([^"]*)"/)
    expect(description.length).toBeGreaterThan(70)
    expect(description.length).toBeLessThanOrEqual(170)
  })
})
