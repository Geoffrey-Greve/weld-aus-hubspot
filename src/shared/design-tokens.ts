/**
 * Design tokens - TypeScript mirror of theme/assets/css/tokens.css.
 * Use these constants in React components for type-safe CSS variable references.
 * Keep in sync with tokens.css. See CLAUDE.md § 5.3.
 *
 * Usage:
 *   import { TOKENS } from '@shared/design-tokens'
 *   <div style={{ color: TOKENS.color.primary }}>
 */

export const TOKENS = {
  color: {
    primary:          'var(--wa-color-primary)',
    primaryLight:     'var(--wa-color-primary-light)',
    primaryDark:      'var(--wa-color-primary-dark)',
    secondary:        'var(--wa-color-secondary)',
    secondaryLight:   'var(--wa-color-secondary-light)',
    secondaryDark:    'var(--wa-color-secondary-dark)',
    accent:           'var(--wa-color-accent)',
    accentDark:       'var(--wa-color-accent-dark)',
    magentaText:      'var(--wa-color-magenta-text)',
    magentaOnDark:    'var(--wa-color-magenta-on-dark)',
    goldText:         'var(--wa-color-gold-text)',
    onPrimary:        'var(--wa-color-on-primary)',
    onSecondary:      'var(--wa-color-on-secondary)',
    onAccent:         'var(--wa-color-on-accent)',
    surface:          'var(--wa-color-surface)',
    surface2:         'var(--wa-color-surface-2)',
    surface3:         'var(--wa-color-surface-3)',
    surfaceInverse:   'var(--wa-color-surface-inverse)',
    text:             'var(--wa-color-text)',
    textMuted:        'var(--wa-color-text-muted)',
    textSubtle:       'var(--wa-color-text-subtle)',
    textInverse:      'var(--wa-color-text-inverse)',
    textMutedOnDark:  'var(--wa-color-text-muted-on-dark)',
    textDisabled:     'var(--wa-color-text-disabled)',
    border:           'var(--wa-color-border)',
    borderStrong:     'var(--wa-color-border-strong)',
    borderFocus:      'var(--wa-color-border-focus)',
    tierGold:         'var(--wa-color-tier-gold)',
    tierGoldBg:       'var(--wa-color-tier-gold-bg)',
    tierSilver:       'var(--wa-color-tier-silver)',
    tierSilverBg:     'var(--wa-color-tier-silver-bg)',
    tierBronze:       'var(--wa-color-tier-bronze)',
    tierBronzeBg:     'var(--wa-color-tier-bronze-bg)',
    success:          'var(--wa-color-success)',
    successSurface:   'var(--wa-color-success-surface)',
    successBorder:    'var(--wa-color-success-border)',
    successText:      'var(--wa-color-success-text)',
    successOnDark:    'var(--wa-color-success-on-dark)',
    warning:          'var(--wa-color-warning)',
    warningSurface:   'var(--wa-color-warning-surface)',
    warningBorder:    'var(--wa-color-warning-border)',
    danger:           'var(--wa-color-danger)',
    dangerSurface:    'var(--wa-color-danger-surface)',
    dangerBorder:     'var(--wa-color-danger-border)',
    info:             'var(--wa-color-info)',
    infoSurface:      'var(--wa-color-info-surface)',
    infoBorder:       'var(--wa-color-info-border)',
    infoText:         'var(--wa-color-info-text)'
  },

  text: {
    xs:   'var(--wa-text-xs)',
    sm:   'var(--wa-text-sm)',
    base: 'var(--wa-text-base)',
    md:   'var(--wa-text-md)',
    lg:   'var(--wa-text-lg)',
    xl:   'var(--wa-text-xl)',
    '2xl': 'var(--wa-text-2xl)',
    '3xl': 'var(--wa-text-3xl)',
    '4xl': 'var(--wa-text-4xl)',
    '5xl': 'var(--wa-text-5xl)'
  },

  leading: {
    none:    'var(--wa-leading-none)',
    tight:   'var(--wa-leading-tight)',
    snug:    'var(--wa-leading-snug)',
    normal:  'var(--wa-leading-normal)',
    relaxed: 'var(--wa-leading-relaxed)',
    loose:   'var(--wa-leading-loose)'
  },

  weight: {
    normal:   'var(--wa-weight-normal)',
    medium:   'var(--wa-weight-medium)',
    semibold: 'var(--wa-weight-semibold)',
    bold:     'var(--wa-weight-bold)'
  },

  font: {
    heading: 'var(--wa-font-heading)',
    body:    'var(--wa-font-body)',
    mono:    'var(--wa-font-mono)'
  },

  space: {
    1:  'var(--wa-space-1)',
    2:  'var(--wa-space-2)',
    3:  'var(--wa-space-3)',
    4:  'var(--wa-space-4)',
    5:  'var(--wa-space-5)',
    6:  'var(--wa-space-6)',
    8:  'var(--wa-space-8)',
    10: 'var(--wa-space-10)',
    12: 'var(--wa-space-12)',
    16: 'var(--wa-space-16)',
    20: 'var(--wa-space-20)',
    24: 'var(--wa-space-24)',
    32: 'var(--wa-space-32)'
  },

  container: {
    narrow:  'var(--wa-container-narrow)',
    default: 'var(--wa-container-default)',
    wide:    'var(--wa-container-wide)'
  },

  radius: {
    none: 'var(--wa-radius-none)',
    sm:   'var(--wa-radius-sm)',
    md:   'var(--wa-radius-md)',
    lg:   'var(--wa-radius-lg)',
    xl:   'var(--wa-radius-xl)',
    full: 'var(--wa-radius-full)'
  },

  shadow: {
    sm:   'var(--wa-shadow-sm)',
    card: 'var(--wa-shadow-card)',
    md:   'var(--wa-shadow-md)',
    lg:   'var(--wa-shadow-lg)',
    xl:   'var(--wa-shadow-xl)'
  },

  z: {
    below:    'var(--wa-z-below)',
    base:     'var(--wa-z-base)',
    raised:   'var(--wa-z-raised)',
    dropdown: 'var(--wa-z-dropdown)',
    sticky:   'var(--wa-z-sticky)',
    overlay:  'var(--wa-z-overlay)',
    modal:    'var(--wa-z-modal)',
    toast:    'var(--wa-z-toast)',
    tooltip:  'var(--wa-z-tooltip)'
  },

  duration: {
    fast:   'var(--wa-duration-fast)',
    normal: 'var(--wa-duration-normal)',
    slow:   'var(--wa-duration-slow)'
  },

  touchMin: 'var(--wa-touch-min)'
} as const

/**
 * Pixel breakpoint values for use with window.matchMedia in React.
 * These match the breakpoints in tokens.css and theme.json.
 */
export const BREAKPOINTS = {
  sm:  640,
  md:  768,
  lg:  1024,
  xl:  1280,
  xxl: 1536
} as const

export type Breakpoint = keyof typeof BREAKPOINTS
