/**
 * WCAG 1.4.3 Contrast (Minimum) — AA ratio checks against live token values.
 *
 * Unlike wcag-source-regressions.test.ts (which only asserts token *names*
 * exist), these tests parse the hex values from tokens.css / component CSS and
 * assert the actual contrast ratio meets AA:
 *   - 4.5:1 for normal text
 *   - 3:1   for large text / UI component graphics (when noted)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  readCssHexToken,
  WCAG_AA_LARGE,
  WCAG_AA_NORMAL,
} from '../shared/utils/contrast'

const root = resolve(__dirname, '../..')
const tokensCss = readFileSync(resolve(root, 'theme/assets/css/tokens.css'), 'utf8')
const componentsCss = readFileSync(resolve(root, 'theme/assets/css/components.css'), 'utf8')
const famCss = readFileSync(resolve(root, 'src/modules/find-a-member/FindAMember.css'), 'utf8')
const profileFormCss = readFileSync(resolve(root, 'theme/modules/profile-form.module/module.css'), 'utf8')
const profilePageTemplate = readFileSync(resolve(root, 'theme/templates/pages/profile.html'), 'utf8')
const memberPreviewTemplate = readFileSync(resolve(root, 'theme/templates/pages/member-preview-1.html'), 'utf8')
const featuredCoursesCss = readFileSync(resolve(root, 'theme/modules/featured-courses.module/module.css'), 'utf8')
const featuredCoursesTemplate = readFileSync(resolve(root, 'theme/modules/featured-courses.module/module.html'), 'utf8')
const coursesLandingCss = readFileSync(resolve(root, 'theme/assets/css/courses-landing.css'), 'utf8')
const coursePathwaysCss = readFileSync(resolve(root, 'theme/modules/course-pathways.module/module.css'), 'utf8')
const coursePathwaysTemplate = readFileSync(resolve(root, 'theme/modules/course-pathways.module/module.html'), 'utf8')
const certificationDetailCss = readFileSync(resolve(root, 'theme/assets/css/certification-detail.css'), 'utf8')
const certificationTemplate = readFileSync(resolve(root, 'theme/templates/pages/certification.html'), 'utf8')
const credentialGridCss = readFileSync(resolve(root, 'theme/modules/credential-grid.module/module.css'), 'utf8')
const checklistCss = readFileSync(resolve(root, 'theme/modules/checklist.module/module.css'), 'utf8')
const membershipOptionsCss = readFileSync(resolve(root, 'theme/modules/membership-options.module/module.css'), 'utf8')
const membershipTestimonialsCss = readFileSync(resolve(root, 'theme/modules/membership-testimonials-grid.module/module.css'), 'utf8')
const eventsListingCss = readFileSync(resolve(root, 'src/modules/events-listing/EventsListing.css'), 'utf8')
const eventDetailCss = readFileSync(resolve(root, 'theme/assets/css/event-detail.css'), 'utf8')
const eventsRouterTemplate = readFileSync(resolve(root, 'theme/templates/pages/events.html'), 'utf8')
const eventDetailTemplate = readFileSync(resolve(root, 'theme/templates/pages/event-detail.html'), 'utf8')
const eventsListingTemplate = readFileSync(resolve(root, 'theme/modules/events-listing.module/module.html'), 'utf8')
const awardsTemplate = readFileSync(resolve(root, 'theme/templates/pages/2026-welding-excellence-awards.html'), 'utf8')
const cardGridCss = readFileSync(resolve(root, 'theme/modules/card-grid.module/module.css'), 'utf8')
const teamGridCss = readFileSync(resolve(root, 'theme/modules/team-grid.module/module.css'), 'utf8')
const teamMemberProfileCss = readFileSync(resolve(root, 'theme/assets/css/team-profile.css'), 'utf8')
const resourceLibraryCss = readFileSync(resolve(root, 'src/modules/resource-library/ResourceLibrary.css'), 'utf8')
const blogCss = readFileSync(resolve(root, 'theme/assets/css/blog.css'), 'utf8')
const statBandCss = readFileSync(resolve(root, 'theme/modules/stat-band.module/module.css'), 'utf8')
const heroTemplate = readFileSync(resolve(root, 'theme/modules/hero.module/module.html'), 'utf8')
const membershipDirectoryTemplate = readFileSync(resolve(root, 'theme/modules/membership-directory-cta.module/module.html'), 'utf8')
const courseDetailCss = readFileSync(resolve(root, 'theme/assets/css/course-detail.css'), 'utf8')
const courseSessionCardsCss = readFileSync(resolve(root, 'theme/assets/css/course-session-cards.css'), 'utf8')
const sharedHeroTemplate = readFileSync(resolve(root, 'theme/templates/partials/shared-hero.html'), 'utf8')
const authCss = readFileSync(resolve(root, 'theme/assets/css/auth.css'), 'utf8')
const jobBoardCss = readFileSync(resolve(root, 'theme/assets/css/job-board.css'), 'utf8')

const token = (name: string) => readCssHexToken(tokensCss, name)

const expectAa = (
  fg: string,
  bg: string,
  label: string,
  minimum: number = WCAG_AA_NORMAL
) => {
  const ratio = contrastRatio(fg, bg)
  expect(
    ratio,
    `${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (need ≥ ${minimum}:1)`
  ).toBeGreaterThanOrEqual(minimum)
}

describe('WCAG 1.4.3 - body / UI text on surfaces', () => {
  const surface = token('wa-color-surface')
  const surface2 = token('wa-color-surface-2')
  const primary = token('wa-color-primary')
  const inverse = token('wa-color-surface-inverse')

  it.each([
    ['wa-color-text', surface],
    ['wa-color-text-muted', surface],
    ['wa-color-text-subtle', surface],
    ['wa-color-text', surface2],
    ['wa-color-text-muted', surface2],
    ['wa-color-magenta-text', surface],
    ['wa-color-gold-text', surface],
    ['wa-color-success-text', surface],
    ['wa-color-info-text', surface],
    ['wa-color-secondary', surface], // link colour on white
  ] as const)('%s on light surface ≥ 4.5:1', (fgToken, bg) => {
    expectAa(token(fgToken), bg, fgToken)
  })

  it('success-text on success-surface ≥ 4.5:1', () => {
    expectAa(token('wa-color-success-text'), token('wa-color-success-surface'), 'success alert')
  })

  it('info-text on info-surface ≥ 4.5:1', () => {
    expectAa(token('wa-color-info-text'), token('wa-color-info-surface'), 'info alert')
  })

  it('on-primary text on primary ≥ 4.5:1', () => {
    expectAa(token('wa-color-on-primary'), primary, 'on-primary')
  })

  it('on-secondary text on secondary ≥ 4.5:1', () => {
    expectAa(token('wa-color-on-secondary'), token('wa-color-secondary'), 'on-secondary')
  })

  it('on-accent text on accent gold ≥ 4.5:1', () => {
    expectAa(token('wa-color-on-accent'), token('wa-color-accent'), 'on-accent')
  })

  it('inverse / on-dark text tones on navy ≥ 4.5:1', () => {
    expectAa(token('wa-color-text-inverse'), primary, 'text-inverse / primary')
    expectAa(token('wa-color-text-inverse'), inverse, 'text-inverse / inverse')
    expectAa(token('wa-color-magenta-on-dark'), primary, 'magenta-on-dark')
    expectAa(token('wa-color-success-on-dark'), primary, 'success-on-dark')
    expectAa(token('wa-color-text-muted-on-dark'), primary, 'muted-on-dark / primary')
    expectAa(token('wa-color-text-muted-on-dark'), inverse, 'muted-on-dark / inverse')
    expectAa(token('wa-color-text-muted-on-dark'), '#101132', 'muted-on-dark / footer navy')
    expectAa(token('wa-color-text-muted-on-dark'), token('wa-color-primary-light'), 'muted-on-dark / primary-light')
  })
})

describe('WCAG 1.4.3 - brand accents must NOT be used as small text on white', () => {
  const white = token('wa-color-surface')

  it('raw brand magenta fails AA as small text on white (use magenta-text instead)', () => {
    expect(contrastRatio(token('wa-color-magenta'), white)).toBeLessThan(WCAG_AA_NORMAL)
  })

  it('raw brand accent gold fails AA as small text on white (use gold-text instead)', () => {
    expect(contrastRatio(token('wa-color-accent'), white)).toBeLessThan(WCAG_AA_NORMAL)
  })

  it('raw tier-silver fails AA as small text on white', () => {
    expect(contrastRatio(token('wa-color-tier-silver'), white)).toBeLessThan(WCAG_AA_NORMAL)
  })
})

describe('WCAG 1.4.3 - member tier badges (Find a Member + .badge-*)', () => {
  // Hardcoded in FindAMember.css / components.css after the 2026-07 WCAG pass.
  const pairs = [
    { name: 'gold', fg: '#5c3d00', bg: '#fdf8e8' },
    { name: 'silver', fg: '#555555', bg: '#f5f5f5' },
    { name: 'bronze', fg: '#5c2d00', bg: '#fdf3e8' },
  ] as const

  it.each(pairs)('$name badge text ≥ 4.5:1', ({ name, fg, bg }) => {
    expectAa(fg, bg, `${name} fam badge`)
  })

  it('components.css gold/silver/bronze badge colours stay AA', () => {
    // .badge-gold uses #5c3d00 on --wa-color-tier-gold-bg
    expectAa('#5c3d00', token('wa-color-tier-gold-bg'), 'badge-gold')
    expectAa('#555555', token('wa-color-tier-silver-bg'), 'badge-silver')
    expectAa('#5c2d00', token('wa-color-tier-bronze-bg'), 'badge-bronze')
  })

  it('home card-grid gold/green pills use dark parent-tint text (≥ 4.5:1)', () => {
    // photo_overlay + news-media tags on the home "What we offer" / news cards
    expectAa('#5c3d00', token('wa-color-accent'), 'card-grid gold pill')
    expectAa('#0a4d2c', token('wa-color-success-border'), 'card-grid green pill')
  })

  it('FindAMember.css still ships the AA badge colours (regression)', () => {
    expect(famCss).toMatch(/\.wa-fam__tier-badge--gold\s*\{[^}]*color:\s*#5c3d00/s)
    expect(famCss).toMatch(/\.wa-fam__tier-badge--silver\s*\{[^}]*color:\s*#555\b/s)
    expect(famCss).toMatch(/\.wa-fam__tier-badge--bronze\s*\{[^}]*color:\s*#5c2d00/s)
  })
})

describe('WCAG 1.4.3 - semantic badges in components.css', () => {
  it('warning badge text ≥ 4.5:1', () => {
    expectAa('#7a4a00', token('wa-color-warning-surface'), 'badge-warning')
    expect(componentsCss).toMatch(/\.badge-warning\s*\{[^}]*color:\s*#7a4a00/s)
  })

  it('danger badge (danger on danger-surface) ≥ 4.5:1', () => {
    expectAa(token('wa-color-danger'), token('wa-color-danger-surface'), 'badge-danger')
  })

  it('success badge uses success-text token (≥ 4.5:1 already covered)', () => {
    expect(componentsCss).toContain('--wa-color-success-text')
  })
})

describe('WCAG 1.4.11 - non-text contrast (UI indicators) ≥ 3:1', () => {
  // Decorative dividers (--wa-color-border / border-strong) are exempt from
  // 1.4.11. Focus rings and identifying UI chrome are not.
  it('primary (focus ring colour) against surface ≥ 3:1', () => {
    expectAa(token('wa-color-primary'), token('wa-color-surface'), 'focus ring', WCAG_AA_LARGE)
  })

  it('secondary (link / accent chrome) against surface ≥ 3:1', () => {
    expectAa(token('wa-color-secondary'), token('wa-color-surface'), 'secondary chrome', WCAG_AA_LARGE)
  })
})

describe('WCAG 1.4.3 - profile page contrast repairs', () => {
  it('profile form helper/status tones stay AA on light profile surfaces', () => {
    expectAa('#667085', '#ffffff', 'profile field hint on white')
    expectAa('#667085', '#f5f7fb', 'profile field hint on light page')
    expectAa('#5b6770', '#eef2f7', 'profile read-only pill')
    expectAa(token('wa-color-success-text'), '#ffffff', 'profile success status')

    expect(profileFormCss).toMatch(
      /\.wa-form-field__hint\s*\{[^}]*color:\s*var\(--profile-muted\)/s
    )
    expect(profileFormCss).toMatch(
      /\.wa-form-field__pill\s*\{[^}]*color:\s*var\(--wa-color-text-muted,\s*#5b6770\)/s
    )
    expect(profileFormCss).toMatch(
      /\.wa-profile-form__company-status\.is-success\s*\{[^}]*color:\s*var\(--wa-color-success-text,\s*#146c39\)/s
    )
  })

  it('profile hero secondary CTA has an opaque AA contrast surface', () => {
    expectAa('#1c1e4c', '#ffffff', 'profile hero secondary CTA')

    expect(profilePageTemplate).toMatch(
      /#profile-page-hero \.wa-hero__cta\.btn-white-outline[\s\S]*?background:\s*#ffffff;[\s\S]*?color:\s*var\(--wa-color-primary,\s*#1c1e4c\)/s
    )
    expect(memberPreviewTemplate).toMatch(
      /#portal-profile #portal-profile-hero \.wa-hero__cta\.btn-white-outline[\s\S]*?background:\s*#ffffff;[\s\S]*?color:\s*var\(--wa-color-primary,\s*#1c1e4c\)/s
    )
  })
})

describe('WCAG 1.4.3 - /courses listing contrast repairs', () => {
  it('keeps repeated course-card price and badge tones AA on light cards', () => {
    expectAa('#c00d74', '#ffffff', 'courses magenta eyebrow on white')
    expectAa('#c00d74', '#f4f7fa', 'courses magenta eyebrow on light-blue section')
    expectAa('#146c39', '#ffffff', 'featured course member price on white')
    expectAa('#146c39', '#dcfce7', 'featured course green badge text')
    expectAa('#5b6770', '#ffffff', 'featured course struck standard price')
    expectAa('#7a5c00', '#fff7ed', 'featured course short-course badge text')
    expectAa('#0b6570', '#d9f4f6', 'featured course process badge text')
    expectAa('#6f5200', '#fff7d6', 'featured course management badge text')
    expectAa('#0055a4', '#e6f4ff', 'upcoming session blue pill')
  })

  it('ships the active source selectors that WAVE flagged on /courses', () => {
    expect(featuredCoursesCss).toMatch(/\.wa-fc__eyebrow\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s)
    expect(featuredCoursesCss).toMatch(/\.wa-fc__price--member,[\s\S]*?\.wa-fc__price-note\s*\{[\s\S]*color:\s*#146c39/s)
    expect(featuredCoursesCss).toMatch(/\.wa-fc__price--struck\s*\{[\s\S]*color:\s*#5b6770/s)
    expect(featuredCoursesCss).toMatch(/\.wa-fc__filter-count,[\s\S]*?\.wa-fc-location__option span\s*\{[\s\S]*opacity:\s*1/s)
    expect(featuredCoursesTemplate).toContain('<span class="wa-visually-hidden">Search courses</span>')
    expect(coursesLandingCss).toMatch(/\.wa-courses-proof \.wa-courses-eyebrow\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s)
    expect(coursesLandingCss).toMatch(/\.wa-courses-session-card__pricing--member \.wa-courses-session-card__member\s*\{[\s\S]*color:\s*var\(--wa-color-success-text,\s*#146c39\)/s)
  })
})

describe('WCAG 1.4.3 - /training Course Pathways contrast repairs', () => {
  it('keeps the WAVE-flagged Course Pathways tones AA on the training page', () => {
    expectAa('#c00d74', token('wa-color-surface-2'), 'training pathways overline on alternate surface')
    expectAa('#146c39', '#e8f7ef', 'training pathways face-to-face pill')
    expectAa('#ffffff', '#0f1030', 'training pathways image caption')
  })

  it('ships the active source selectors that WAVE flagged on /training', () => {
    expect(coursePathwaysTemplate).toContain('<span class="wa-overline__text">{{ module.overline }}</span>')
    expect(coursePathwaysCss).toMatch(/\.wa-pathways \.wa-overline\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s)
    expect(coursePathwaysCss).toMatch(/\.wa-pathways \.wa-overline::before\s*\{[\s\S]*background:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s)
    expect(coursePathwaysCss).toMatch(/\.wa-pathways__image-card figcaption\s*\{[\s\S]*background:\s*var\(--wa-color-primary-dark,\s*#0f1030\)[\s\S]*color:\s*#fff/s)
    expect(coursePathwaysCss).toMatch(/\.wa-pathways__delivery\s*\{[\s\S]*background:\s*var\(--wa-color-success-surface,\s*#e8f7ef\)[\s\S]*color:\s*var\(--wa-color-success-text,\s*#146c39\)/s)
  })
})

describe('WCAG 1.4.3 - /courses/iwi-s course detail contrast repairs', () => {
  it('keeps repeated course-detail WAVE marker colours AA on their rendered surfaces', () => {
    expectAa('#c00d74', '#ffffff', 'course detail pricing overline on white')
    expectAa('#c00d74', '#f4f7fa', 'course detail sessions overline on light-blue section')
    expectAa('#146c39', '#ffffff', 'course detail member price on white')
    expectAa('#146c39', '#dcfce7', 'course detail green delivery/category pill')
    expectAa('#5b6770', '#ffffff', 'course detail struck standard price on white')
    expectAa('#7a4a00', '#fff7ed', 'course detail orange category/delivery pill')
    expectAa('#0055a4', '#e6f4ff', 'course detail blue standard/date pill')
    expectAa('#1a1a1a', token('wa-color-accent'), 'course detail gold CTA arrow')
  })

  it('ships the active course detail selectors WAVE flagged on /courses/iwi-s', () => {
    expect(sharedHeroTemplate).toContain(
      'stroke="{% if _primary_style == \'gold\' %}#1a1a1a{% else %}currentColor{% endif %}"'
    )
    expect(sharedHeroTemplate).toContain(
      '<line x1="5" y1="12" x2="19" y2="12"{% if _primary_style == \'gold\' %} stroke="#1a1a1a" style="stroke:#1a1a1a;"{% endif %}></line>'
    )
    expect(courseDetailCss).toMatch(/\.wa-pricing-table \.container::before\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s)
    expect(courseDetailCss).toMatch(/\.wa-course-filter-shell__eyebrow\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s)
    expect(courseDetailCss).toMatch(/\.wa-pricing-table__card-kicker\s*\{[\s\S]*color:\s*#0055a4/s)
    expect(courseDetailCss).toMatch(/\.wa-course-filter-shell \.wa-course-filter__price--member\s*\{[\s\S]*color:\s*var\(--wa-color-success-text,\s*#146c39\)/s)
    expect(courseDetailCss).toMatch(/\.wa-course-filter-shell \.wa-course-filter__price--struck\s*\{[\s\S]*color:\s*var\(--wa-color-text-muted,\s*#5b6770\)/s)
    expect(courseSessionCardsCss).toMatch(/\.wa-course-filter-shell \.wa-course-filter__delivery--face-to-face\s*\{[\s\S]*color:\s*var\(--wa-color-success-text,\s*#146c39\)/s)
    expect(courseSessionCardsCss).toMatch(/\.wa-course-filter-shell \.wa-course-filter__delivery--in-house\s*\{[\s\S]*color:\s*#7a4a00/s)
  })
})

describe('WCAG 1.4.3 - /certification ISO 3834 contrast repairs', () => {
  it('keeps related certification code labels AA on white cards', () => {
    expectAa('#8b0a50', '#ffffff', 'certification related-card code label on white')
    expectAa('#8b0a50', '#fdeaf4', 'certification related-card code label chip')
  })

  it('ships the active source selector that WAVE flagged on /certification?pathway=iso-3834', () => {
    expect(certificationDetailCss).toMatch(
      /\.wa-cert-detail-related__code\s*\{[\s\S]*background:\s*#fdeaf4;[\s\S]*color:\s*#8b0a50\s*!important/s
    )
    expect(certificationTemplate).toContain(
      'class="wa-cert-detail-related__code" style="background:#fdeaf4;border-color:rgba(139,10,80,0.16);color:#8b0a50;"'
    )
  })
})

describe('WCAG 1.4.3 - /certification landing contrast repairs', () => {
  it('keeps certification landing small accent text AA on white cards', () => {
    expectAa(token('wa-color-success-text'), '#ffffff', 'certification credential green action on white')
    expectAa(token('wa-color-magenta-text'), '#ffffff', 'certification benefit kicker on white')
  })

  it('ships reusable component selectors for certification WAVE markers', () => {
    expect(credentialGridCss).toMatch(
      /\.wa-credential-grid__card--green \.wa-credential-grid__action\s*\{[\s\S]*color:\s*var\(--wa-color-success-text,\s*#146c39\)/s
    )
    expect(credentialGridCss).toMatch(
      /\.wa-credential-grid__card--magenta \.wa-credential-grid__action\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(checklistCss).toMatch(
      /\.wa-checklist__benefit-kicker\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
  })
})

describe('WCAG 1.4.3 - /membership contrast repairs', () => {
  it('keeps testimonial quote glyphs, membership-option success badges, and the hero gold CTA arrow AA', () => {
    expectAa('#7a5c00', '#ffffff', 'membership testimonial quote glyph on white')
    expectAa(token('wa-color-success-text'), token('wa-color-success-surface'), 'membership options Free tab badge')
    expectAa('#1a1a1a', token('wa-color-accent'), 'membership hero gold CTA arrow')
  })

  it('ships the active source selectors WAVE flagged on /membership', () => {
    expect(membershipOptionsCss).toMatch(
      /\.wa-membership-options__tab-badge\s*\{[\s\S]*color:\s*var\(--wa-color-success-text\)/s
    )
    expect(membershipOptionsCss).toMatch(
      /\.wa-membership-options__card--green \.wa-membership-options__badge\s*\{[\s\S]*color:\s*var\(--wa-color-success-text\)/s
    )
    expect(membershipTestimonialsCss).toMatch(
      /\.wa-membership-testimonials__quote-mark\s*\{[\s\S]*color:\s*var\(--wa-color-gold-text,\s*#7a5c00\)/s
    )
    expect(heroTemplate).toContain(
      '<line x1="5" y1="12" x2="19" y2="12"{% if _is_membership_page and module.primary_cta.style|default(\'gold\') == \'gold\' %} stroke="#1a1a1a" style="stroke:#1a1a1a;"{% endif %}></line>'
    )
    expect(membershipDirectoryTemplate).toContain(
      '<line x1="5" y1="12" x2="19" y2="12" stroke="#1a1a1a" style="stroke:#1a1a1a;"></line>'
    )
  })
})

describe('WCAG 1.4.3 - /events contrast and form-label repairs', () => {
  it('keeps events listing eyebrow and awards badge text AA on light surfaces', () => {
    expectAa(token('wa-color-magenta-text'), '#ffffff', 'events listing eyebrow on white')
    expectAa('#7a4a00', '#fff7ed', 'events listing Awards badge text')
  })

  it('ships the active /events source selectors and search label WAVE flagged', () => {
    expect(eventsListingCss).toMatch(
      /\.wa-el__eyebrow\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(eventsListingCss).toMatch(
      /\.wa-el__badge--awards,[\s\S]*?\.wa-el__type-badge--awards\s*\{[\s\S]*color:\s*#7a4a00/s
    )
    expect(eventsListingTemplate).toContain('<span class="wa-visually-hidden">Search events</span>')
  })
})

describe('WCAG 1.4.3 - event detail contrast repairs', () => {
  it('keeps event detail section kickers AA on white body sections', () => {
    expectAa(token('wa-color-magenta-text'), '#ffffff', 'event detail section kicker on white')
  })

  it('ships the shared event-detail selector WAVE flagged on event detail pages', () => {
    expect(eventDetailCss).toMatch(
      /\.wa-event-detail__section-kicker\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
  })

  it('ships the template-level fallback for stale HubSpot generated event-detail CSS', () => {
    for (const template of [eventsRouterTemplate, eventDetailTemplate]) {
      expect(template).toMatch(
        /\.wa-event-detail__section-kicker\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)\s*!important/s
      )
    }
  })
})

describe('WCAG 1.4.3 - /events/welding-excellence-awards contrast repairs', () => {
  it('keeps awards sponsor tiers, judge roles, and magenta chips AA on white/light cards', () => {
    expectAa('#7a5c00', '#ffffff', 'awards Gold Sponsor tier label')
    expectAa('#555555', '#ffffff', 'awards Silver Sponsor tier label')
    expectAa('#5c2d00', '#ffffff', 'awards Bronze Sponsor tier label')
    expectAa(token('wa-color-magenta-text'), '#ffffff', 'awards judge role on white')
    expectAa('#8b0a50', '#fdeaf4', 'awards magenta ticket region chip')
  })

  it('ships the active awards/shared selectors WAVE flagged', () => {
    expect(awardsTemplate).toMatch(/\.sponsor-tier--gold\s*\{\s*color:\s*#7a5c00;\s*\}/)
    expect(awardsTemplate).toMatch(/\.sponsor-tier--silver\s*\{\s*color:\s*#555555;\s*\}/)
    expect(awardsTemplate).toMatch(/\.sponsor-tier--bronze\s*\{\s*color:\s*#5c2d00;\s*\}/)
    expect(teamGridCss).toMatch(
      /\.wa-team__role\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(cardGridCss).toMatch(
      /\.wa-card-grid__tag--magenta\s*\{\s*background:\s*#fdeaf4;\s*color:\s*#8b0a50;\s*\}/
    )
  })
})

describe('WCAG 1.4.3 - team member profile contrast repairs', () => {
  it('keeps related team-card role text AA on white cards', () => {
    expectAa(token('wa-color-magenta-text'), '#ffffff', 'team profile related role on white')
  })

  it('ships the profile-specific related-card role override that WAVE flagged', () => {
    expect(teamMemberProfileCss).toMatch(
      /\.wa-team-profile__related \.wa-team__role\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
  })
})

describe('WCAG 1.4.3 - /resources contrast repairs', () => {
  it('keeps resource access legend tier badges AA for small white text', () => {
    expectAa('#ffffff', '#8a4b16', 'resources Bronze access badge')
    expectAa('#ffffff', '#6b7280', 'resources Silver access badge')
  })

  it('ships the active resource-library badge fills WAVE flagged', () => {
    expect(resourceLibraryCss).toMatch(/\.wa-rl__access-badge--bronze\s*\{\s*background:\s*#8a4b16;\s*\}/)
    expect(resourceLibraryCss).toMatch(/\.wa-rl__access-badge--silver\s*\{\s*background:\s*#6b7280;\s*\}/)
  })
})

describe('WCAG 1.4.3 - /news blog listing contrast repairs', () => {
  it('keeps repeated news metadata, overlines, and topic chips AA', () => {
    expectAa(token('wa-color-text-muted'), '#ffffff', 'news metadata on white')
    expectAa(token('wa-color-text-muted'), token('wa-color-surface-2'), 'news metadata on light surface')
    expectAa(token('wa-color-magenta-text'), '#ffffff', 'news magenta overline on white')
    expectAa(token('wa-color-magenta-text'), token('wa-color-surface-2'), 'news magenta overline on surface')
    expectAa(token('wa-color-success-text'), '#e8f7ef', 'news green topic tag')
    expectAa(token('wa-color-magenta-text'), '#fdeaf4', 'news magenta topic tag')
    expectAa('#b4381f', '#fdeee9', 'news orange topic tag')
    expectAa(token('wa-color-gold-text'), '#fff7ed', 'news standards topic tag')
  })

  it('ships the shared blog selectors that WAVE flagged on /news', () => {
    expect(blogCss).toMatch(/--wa-blog-magenta-text:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/)
    expect(blogCss).toMatch(/--wa-blog-subtle:\s*var\(--wa-color-text-muted,\s*#5f6674\)/)
    expect(blogCss).toMatch(/\.wa-blog-overline\s*\{[\s\S]*color:\s*var\(--wa-blog-magenta-text\)/s)
    expect(blogCss).toMatch(/\.wa-topic-tag--quality-and-safety\s*\{\s*--wa-topic-color:\s*var\(--wa-blog-green-text\)/)
    expect(blogCss).toMatch(/\.wa-topic-tag--skills-shortage\s*\{\s*--wa-topic-color:\s*var\(--wa-blog-magenta-text\)/)
    expect(blogCss).toMatch(/\.wa-topic-tag--onshoring\s*\{\s*--wa-topic-color:\s*var\(--wa-blog-orange-text\)/)
  })
})

describe('WCAG 1.4.3 - /advocacy stat-band contrast repairs', () => {
  it('keeps stat-band sublabels AA on the alternating navy cards', () => {
    expectAa(token('wa-color-text-muted-on-dark'), token('wa-color-primary'), 'advocacy stat sublabel on navy')
    expectAa(token('wa-color-text-muted-on-dark'), token('wa-color-primary-dark'), 'stat media sublabel on dark navy')
  })

  it('ships the shared stat-band selectors WAVE flagged on /advocacy', () => {
    expect(statBandCss).toMatch(
      /\.wa-section--bg-surface \.wa-stat-band__stat:nth-child\(odd\) \.wa-stat-band__sublabel,[\s\S]*?\.wa-stat-band--media \.wa-stat-band__sublabel\s*\{[\s\S]*color:\s*var\(--wa-color-text-muted-on-dark,\s*#c5cadf\)/s
    )
  })
})

describe('WCAG 1.4.3 - auth system page contrast repairs', () => {
  it('keeps auth reset overline text AA on white cards', () => {
    expectAa(token('wa-color-magenta-text'), token('wa-color-surface'), 'auth reset overline on white')
  })

  it('ships the shared auth reset selector WAVE flagged on /_hcms/mem/reset/request', () => {
    expect(authCss).toMatch(
      /\.auth-reset__eyebrow \.wa-overline__text\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(authCss).toMatch(
      /\.auth-reset__eyebrow::before\s*\{[\s\S]*background:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
  })

  it('ships the shared auth signup selector WAVE flagged on /signup', () => {
    expect(authCss).toMatch(
      /\.auth-signup__eyebrow \.wa-overline__text\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(authCss).toMatch(
      /\.auth-signup__eyebrow::before\s*\{[\s\S]*background:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
  })
})

describe('WCAG 1.4.3 - /job-board contrast repairs', () => {
  it('keeps repeated job-board role accents AA on their rendered surfaces', () => {
    expectAa(token('wa-color-magenta-text'), token('wa-color-surface'), 'job-board overline on white')
    expectAa(token('wa-color-magenta-text'), token('wa-color-surface-2'), 'job-board overline on light section')
    expectAa('#8a4f00', '#fff7ed', 'job-board inspection badge on warning tint')
    expectAa(token('wa-color-magenta-text'), '#fdeaf4', 'job-board leadership badge on magenta tint')
    expectAa(token('wa-color-success-text'), token('wa-color-success-surface'), 'job-board apprenticeships badge on green tint')
    expectAa(token('wa-color-text-muted'), token('wa-color-surface-2'), 'job-board showing-results status on light section')
    expectAa('#ffffff', '#8a4f00', 'job-board inspection apply button')
    expectAa('#ffffff', token('wa-color-magenta-text'), 'job-board leadership apply button')
    expectAa('#ffffff', token('wa-color-success-text'), 'job-board apprenticeships apply button')
    expectAa(token('wa-color-magenta-on-dark'), token('wa-color-primary-dark'), 'job-board magenta CTA icon on dark card')
  })

  it('ships the active job-board selectors WAVE flagged on /job-board', () => {
    expect(jobBoardCss).toMatch(
      /\.wa-job-board__eyebrow\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(jobBoardCss).toMatch(
      /\.wa-job-board-category--inspection,[\s\S]*?\.wa-job-board-monogram--inspection\s*\{[\s\S]*color:\s*#8a4f00/s
    )
    expect(jobBoardCss).toMatch(
      /\.wa-job-board-category--leadership,[\s\S]*?\.wa-job-board-monogram--leadership\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(jobBoardCss).toMatch(
      /\.wa-job-board-category--apprenticeships,[\s\S]*?\.wa-job-board-monogram--apprenticeships\s*\{[\s\S]*color:\s*var\(--wa-color-success-text,\s*#146c39\)/s
    )
    expect(jobBoardCss).toMatch(
      /\.wa-job-board-chip span\[data-category-count\]\s*\{[\s\S]*opacity:\s*1;[\s\S]*color:\s*currentColor/s
    )
    expect(jobBoardCss).toContain('.wa-job-board-card--inspection { --wa-card-accent: #8a4f00; }')
    expect(jobBoardCss).toContain('.wa-job-board-card--leadership { --wa-card-accent: var(--wa-color-magenta-text, #c00d74); }')
    expect(jobBoardCss).toContain('.wa-job-board-card--apprenticeships { --wa-card-accent: var(--wa-color-success-text, #146c39); }')
    expect(jobBoardCss).toMatch(
      /\.wa-job-board-showing\s*\{[\s\S]*color:\s*var\(--wa-color-text-muted,\s*#5b6770\)/s
    )
    expect(jobBoardCss).toMatch(
      /\.wa-job-board-clear\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-text,\s*#c00d74\)/s
    )
    expect(jobBoardCss).toMatch(
      /\.wa-job-board-cta-card__icon--magenta\s*\{[\s\S]*color:\s*var\(--wa-color-magenta-on-dark,\s*#ff7eb8\)/s
    )
  })
})
