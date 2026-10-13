import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
  WCAG_AA_NORMAL,
} from './contrast'

describe('contrast utils', () => {
  it('parses 3- and 6-digit hex', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('#1a1a1a')).toEqual({ r: 26, g: 26, b: 26 })
  })

  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('same colour is 1:1', () => {
    expect(contrastRatio('#1c1e4c', '#1c1e4c')).toBeCloseTo(1, 5)
  })

  it('order of foreground/background does not matter', () => {
    expect(contrastRatio('#1a1a1a', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#1a1a1a'),
      10
    )
  })

  it('relative luminance of white is 1 and black is 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })

  it('meetsContrast uses the AA normal threshold by default path', () => {
    expect(meetsContrast('#1a1a1a', '#ffffff', WCAG_AA_NORMAL)).toBe(true)
    expect(meetsContrast('#bbbbbb', '#ffffff', WCAG_AA_NORMAL)).toBe(false)
  })
})
