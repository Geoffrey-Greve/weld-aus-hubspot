import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
    })

  if (!channels || channels.length !== 3) return 0

  const [r, g, b] = channels as [number, number, number]
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('My Invoices contrast tokens', () => {
  it('uses a darker payable green for invoice payment actions and balance text', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../theme/modules/my-invoices.module/module.css'),
      'utf8',
    )

    expect(contrastRatio('#ffffff', '#1f8a4d')).toBeLessThan(4.5)
    expect(contrastRatio('#ffffff', '#146c39')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#1f8a4d', '#ffffff')).toBeLessThan(4.5)
    expect(contrastRatio('#146c39', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(css).toContain('--wa-my-invoices-success-action: var(--wa-color-success-text, #146c39);')
    expect(css).toMatch(/\.wa-my-invoices__action--pay\s*\{[\s\S]*?background:\s*var\(--wa-my-invoices-success-action\);/)
    expect(css).toMatch(/\.wa-my-invoices__action--pay\s*\{[\s\S]*?border-color:\s*var\(--wa-my-invoices-success-action\);/)
    expect(css).toMatch(/\.wa-my-invoices__balance\s*\{[\s\S]*?color:\s*var\(--wa-my-invoices-success-action\);/)
  })
})
