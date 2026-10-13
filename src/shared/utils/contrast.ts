/**
 * WCAG 2.x relative luminance + contrast ratio helpers (ISO 9241-3 / WCAG 1.4.3).
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

export const WCAG_AA_NORMAL = 4.5
export const WCAG_AA_LARGE = 3
export const WCAG_AAA_NORMAL = 7
export const WCAG_AAA_LARGE = 4.5

export type Rgb = { r: number; g: number; b: number }

/** Parse #rgb / #rrggbb / #rrggbbaa (alpha ignored) into 0–255 channels. */
export function parseHexColor(hex: string): Rgb {
  const raw = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(raw)) {
    throw new Error(`Invalid hex colour: ${hex}`)
  }
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance in [0, 1] (WCAG definition). */
export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? parseHexColor(color) : color
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  )
}

/** Contrast ratio ≥ 1 (lighter / darker, with the WCAG 0.05 offset). */
export function contrastRatio(foreground: string | Rgb, background: string | Rgb): number {
  const l1 = relativeLuminance(foreground)
  const l2 = relativeLuminance(background)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function meetsContrast(
  foreground: string | Rgb,
  background: string | Rgb,
  minimum: number
): boolean {
  return contrastRatio(foreground, background) >= minimum
}

/**
 * Extract a resolved hex value for a CSS custom property from a stylesheet
 * string. Only matches literal `#hex` assignments (not `var(...)` aliases).
 */
export function readCssHexToken(css: string, tokenName: string): string {
  const name = tokenName.startsWith('--') ? tokenName : `--${tokenName}`
  const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(#[0-9a-fA-F]{3,8})`)
  const match = css.match(re)
  const hex = match?.[1]
  if (!hex) {
    throw new Error(`No hex value found for ${name} in stylesheet`)
  }
  return hex
}
