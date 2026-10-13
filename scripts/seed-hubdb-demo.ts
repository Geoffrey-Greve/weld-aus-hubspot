/**
 * Seeds DEMO rows into each HubDB table so pages render without waiting for
 * real client content. Idempotent: by default it purges existing draft rows
 * from each target table before re-inserting the demo set, so re-runs do not
 * accumulate duplicates. Tables themselves are NOT created here - run
 * `pnpm seed:hubdb` first to create the schemas.
 *
 * Before writing rows, this script re-asserts `allowPublicApiAccess` from
 * `hubdb/<table>.json` so private tables (e.g. jobs with application_email)
 * cannot stay publicly readable if the schema seeder was skipped or an older
 * public table is being re-populated.
 *
 * Usage:
 *   pnpm seed:hubdb:demo --env=staging
 *   pnpm seed:hubdb:demo --env=production --dry-run
 *   pnpm seed:hubdb:demo --env=staging --no-purge
 *   pnpm seed:hubdb:demo --env=staging --only=courses
 *
 * Credentials: same as scripts/seed-hubdb.ts (env token, else CLI personal access key).
 *
 * The demo content uses clearly fictional Australian company / person names
 * so it is safe to leave on staging. Names will be replaced with the
 * client-supplied directory and team data before production cutover.
 */
import { Client } from '@hubspot/api-client'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'
import { stateForCity } from './lib/course-state'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}
const envRaw = flag('env') ?? 'staging'
const dryRun = args.includes('--dry-run')
const noPurge = args.includes('--no-purge')
const onlyTable = flag('only')

const envParsed = normaliseEnv(envRaw)
if (!envParsed) {
  console.error(`[seed-hubdb-demo] Unknown --env="${envRaw}". Must be staging or production.`)
  process.exit(1)
}
// Narrowed here rather than relied on at each use: TS does not carry the
// null check into the async main() that consumes it.
const env: HubSpotEnv = envParsed

let tablesApi: any
let rowsApi: any
let rowsBatchApi: any

// ---------------------------------------------------------------------------
// Demo fixtures
// ---------------------------------------------------------------------------

// `_`-prefixed keys are row metadata, not column values - rowToValues() skips them.
//   _name → the row's display name in the HubDB UI
//   _path → the row's page path (hs_path), i.e. the {slug} segment of a dynamic
//           page URL. Required on every row of a table with useForPages: true.
type RawRow = Record<string, unknown> & { _name?: string; _path?: string }

function isoDate(s: string): number {
  // HubDB DATE columns accept milliseconds since epoch at UTC midnight.
  return Date.parse(`${s}T00:00:00Z`)
}

const COURSES: RawRow[] = [
  // ---- AS1796 Welding Supervisor Certificate 10 (sales-template course) ----
  {
    course_name: 'AS1796 Welding Supervisor Certificate 10',
    course_id: 'as1796-cert-10',
    course_slug: 'as1796-welding-supervisor-certificate-10',
    parent_template: 'sales',
    city: 'Sydney',
    start_date: isoDate('2026-07-13'),
    end_date: isoDate('2026-07-24'),
    price_member: 3950,
    price_non_member: 4950,
    registration_url: 'https://events.weldaustralia.com.au/as1796-cert10/sydney-jul26',
    category: 'Supervision',
    delivery_mode: 'Face-to-Face',
    status: 'Available',
    seats_remaining: 6,
    meta_description:
      'AS1796 Welding Supervisor Certificate 10 - two-week intensive covering supervision, documentation and code compliance for Australian fabrication.',
    page_title: 'AS1796 Welding Supervisor Certificate 10 | Weld Australia',
  },
  {
    course_name: 'AS1796 Welding Supervisor Certificate 10',
    course_id: 'as1796-cert-10',
    course_slug: 'as1796-welding-supervisor-certificate-10',
    parent_template: 'sales',
    city: 'Melbourne',
    start_date: isoDate('2026-09-07'),
    end_date: isoDate('2026-09-18'),
    price_member: 3950,
    price_non_member: 4950,
    registration_url: 'https://events.weldaustralia.com.au/as1796-cert10/melbourne-sep26',
    category: 'Supervision',
    delivery_mode: 'Face-to-Face',
    status: 'Available',
    seats_remaining: 10,
  },
  {
    course_name: 'AS1796 Welding Supervisor Certificate 10',
    course_id: 'as1796-cert-10',
    course_slug: 'as1796-welding-supervisor-certificate-10',
    parent_template: 'sales',
    city: 'Brisbane',
    start_date: isoDate('2026-11-02'),
    end_date: isoDate('2026-11-13'),
    price_member: 3950,
    price_non_member: 4950,
    registration_url: 'https://events.weldaustralia.com.au/as1796-cert10/brisbane-nov26',
    category: 'Supervision',
    delivery_mode: 'Blended',
    status: 'Available',
    seats_remaining: 12,
  },

  // ---- IIW International Welding Inspector (sales-template course) ----
  {
    course_name: 'IIW International Welding Inspector',
    course_id: 'iiw-international-welding-inspector',
    course_slug: 'iiw-international-welding-inspector',
    parent_template: 'sales',
    city: 'Sydney',
    start_date: isoDate('2026-08-03'),
    end_date: isoDate('2026-08-28'),
    price_member: 7850,
    price_non_member: 9450,
    registration_url: 'https://events.weldaustralia.com.au/iiw-inspector/sydney-aug26',
    category: 'Welding Inspection',
    delivery_mode: 'Face-to-Face',
    status: 'Available',
    seats_remaining: 4,
    meta_description:
      'IIW International Welding Inspector - four-week diploma-level training to the IIW Comprehensive (IWI-C) syllabus, delivered in Sydney.',
    page_title: 'IIW International Welding Inspector | Weld Australia',
  },
  {
    course_name: 'IIW International Welding Inspector',
    course_id: 'iiw-international-welding-inspector',
    course_slug: 'iiw-international-welding-inspector',
    parent_template: 'sales',
    city: 'Online',
    start_date: isoDate('2026-10-12'),
    end_date: isoDate('2026-11-20'),
    price_member: 7250,
    price_non_member: 8800,
    registration_url: 'https://events.weldaustralia.com.au/iiw-inspector/online-oct26',
    category: 'Welding Inspection',
    delivery_mode: 'Online',
    status: 'Available',
    seats_remaining: 18,
  },

  // ---- Standard-template courses ----
  {
    course_name: 'Visual Welding Inspection (VWI)',
    course_id: 'visual-welding-inspection',
    course_slug: 'visual-welding-inspection',
    parent_template: 'standard',
    city: 'Sydney',
    start_date: isoDate('2026-07-20'),
    end_date: isoDate('2026-07-22'),
    price_member: 1150,
    price_non_member: 1450,
    registration_url: 'https://events.weldaustralia.com.au/vwi/sydney-jul26',
    category: 'Welding Inspection',
    delivery_mode: 'Face-to-Face',
    status: 'Available',
    seats_remaining: 14,
  },
  {
    course_name: 'Visual Welding Inspection (VWI)',
    course_id: 'visual-welding-inspection',
    course_slug: 'visual-welding-inspection',
    parent_template: 'standard',
    city: 'Perth',
    start_date: isoDate('2026-08-17'),
    end_date: isoDate('2026-08-19'),
    price_member: 1150,
    price_non_member: 1450,
    registration_url: 'https://events.weldaustralia.com.au/vwi/perth-aug26',
    category: 'Welding Inspection',
    delivery_mode: 'Face-to-Face',
    status: 'Available',
    seats_remaining: 8,
  },
  {
    course_name: 'Welding Supervision Fundamentals',
    course_id: 'welding-supervision-fundamentals',
    course_slug: 'welding-supervision-fundamentals',
    parent_template: 'standard',
    city: 'Melbourne',
    start_date: isoDate('2026-09-21'),
    end_date: isoDate('2026-09-25'),
    price_member: 2100,
    price_non_member: 2650,
    registration_url: 'https://events.weldaustralia.com.au/wsf/melbourne-sep26',
    category: 'Supervision',
    delivery_mode: 'Face-to-Face',
    status: 'Sold Out',
    seats_remaining: 0,
  },
  {
    course_name: 'ISO 3834 Implementation Workshop',
    course_id: 'iso-3834-implementation-workshop',
    course_slug: 'iso-3834-implementation-workshop',
    parent_template: 'standard',
    city: 'Online',
    start_date: isoDate('2026-06-25'),
    end_date: isoDate('2026-06-26'),
    price_member: 695,
    price_non_member: 950,
    registration_url: 'https://events.weldaustralia.com.au/iso3834-workshop/online-jun26',
    category: 'Management',
    delivery_mode: 'Online',
    status: 'Available',
    seats_remaining: 30,
  },
]

const MEMBERS: RawRow[] = [
  {
    company_name: 'Southern Cross Fabrication',
    member_tier: 'Gold',
    company_blurb:
      '<p>Large-scale structural fabricator specialising in defence, rail and infrastructure projects across the eastern seaboard.</p>',
    website_url: 'https://example.com/southern-cross-fab',
    contact_email: 'enquiries@example.com',
    state_operation: ['NSW', 'VIC', 'QLD'],
    is_active: true,
  },
  {
    company_name: 'Pilbara Heavy Industries',
    member_tier: 'Gold',
    company_blurb:
      '<p>Mining-sector fabrication, repair and field services across the Pilbara and Goldfields-Esperance regions.</p>',
    website_url: 'https://example.com/pilbara-heavy',
    contact_email: 'hello@example.com',
    state_operation: ['WA', 'NT'],
    is_active: true,
  },
  {
    company_name: 'Hunter Valley Welding Co.',
    member_tier: 'Silver',
    company_blurb:
      '<p>Pressure-vessel and pipework specialists serving the Hunter region energy and resources sector.</p>',
    website_url: 'https://example.com/hunter-valley-welding',
    contact_email: 'office@example.com',
    state_operation: ['NSW'],
    is_active: true,
  },
  {
    company_name: 'Tasman Marine Welding',
    member_tier: 'Silver',
    company_blurb:
      '<p>Marine and offshore welding services - ferries, fishing fleets and aquaculture infrastructure.</p>',
    website_url: 'https://example.com/tasman-marine',
    contact_email: 'hello@example.com',
    state_operation: ['TAS', 'VIC'],
    is_active: true,
  },
  {
    company_name: 'Capricorn Coast Welders',
    member_tier: 'Bronze',
    company_blurb:
      '<p>Mid-sized job shop covering Rockhampton through Mackay - agriculture, mining and civil contracting.</p>',
    website_url: 'https://example.com/capricorn-coast',
    contact_email: 'team@example.com',
    state_operation: ['QLD'],
    is_active: true,
  },
  {
    company_name: 'Murray-Darling Engineering',
    member_tier: 'Bronze',
    company_blurb:
      '<p>Regional fabricator supporting irrigation, agribusiness and renewables across the Murray-Darling basin.</p>',
    website_url: 'https://example.com/murray-darling',
    contact_email: 'enquiries@example.com',
    state_operation: ['NSW', 'VIC', 'SA'],
    is_active: true,
  },
  {
    company_name: 'Snowy Mountains Fabricators',
    member_tier: 'Bronze',
    company_blurb:
      '<p>Alpine-region structural and pipework fabrication, supporting renewables and water infrastructure projects.</p>',
    website_url: 'https://example.com/snowy-mountains',
    contact_email: 'office@example.com',
    state_operation: ['NSW', 'ACT'],
    is_active: true,
  },
  {
    company_name: 'Arnhem Iron & Steel',
    member_tier: 'Reciprocal',
    company_blurb:
      '<p>Top End fabricator delivering remote-site welding and steel supply for resources and defence sectors.</p>',
    website_url: 'https://example.com/arnhem-iron-steel',
    contact_email: 'hello@example.com',
    state_operation: ['NT'],
    is_active: true,
  },
  {
    company_name: 'Bass Strait Filler Metals',
    member_tier: 'Industry Supplier',
    company_blurb:
      '<p>Distributor of welding consumables, filler metals and shielding gases to the Australian fabrication industry.</p>',
    website_url: 'https://example.com/bass-strait-fillers',
    contact_email: 'sales@example.com',
    state_operation: ['National'],
    is_active: true,
  },
]

// Mirrors the people previously hardcoded in theme/templates/pages/about.html so
// the About page reads identically once both grids switch to `data_source="hubdb"`.
//
// `_path` is the {person-name} segment of /about/team/{person-name} - it must be
// unique across the table and stable, because it is the page's public URL.
// Honorifics are dropped from the path but kept in `name`.
//
// One row per person - and therefore one profile page per person - even when
// someone belongs in both grids. `is_board_member` drives the board grid and
// `category` drives the staff grid, so Geoff Crittenden appears on both: he sits
// on the Board as CEO and leads the corporate team. `display_order` interleaves
// the two lists (board 1-6, staff 3 then 11+) so each grid reads in the right
// order from one column.
//
// Categories match the SELECT options on the live table (Board, Corporate,
// Strategic Partnerships, Education & Training, Q&C, Engineering, Corporate
// Services) - the grids group by these labels, so demo values that don't exist
// in production would give a misleading preview.
//
// Bios and headshots here are placeholders. Real copy and imagery come from
// Danielle (CLAUDE.md §13 Q3/Q8).
const TEAM_AND_BOARD: RawRow[] = [
  // ── Board ──────────────────────────────────────────────────────────────────
  {
    _path: 'ian-harris',
    name: 'Prof. Ian Harris',
    role: 'Chairman',
    org: 'Industry Representative',
    category: 'Board',
    bio: '<p>Chairs the Weld Australia Board, bringing decades of research and industry leadership to the organisation&rsquo;s strategic direction. Placeholder bio.</p>',
    is_board_member: true,
    display_order: 1,
    is_active: true,
  },
  {
    _path: 'patricia-morrison',
    name: 'Dr. Patricia Morrison',
    role: 'Deputy Chair',
    org: 'Industry Representative',
    category: 'Board',
    bio: '<p>Deputy Chair of the Board, with a background spanning materials research and heavy manufacturing. Placeholder bio.</p>',
    is_board_member: true,
    display_order: 2,
    is_active: true,
  },
  {
    _path: 'robert-gillies',
    name: 'Robert Gillies',
    role: 'Board Director',
    org: 'Industry Representative',
    category: 'Board',
    bio: '<p>Board Director representing the interests of Australian fabricators and their workforces. Placeholder bio.</p>',
    is_board_member: true,
    display_order: 4,
    is_active: true,
  },
  {
    _path: 'lynette-thomson',
    name: 'Lynette Thomson',
    role: 'Board Director',
    org: 'Industry Representative',
    category: 'Board',
    bio: '<p>Board Director with extensive experience in skills development and vocational education. Placeholder bio.</p>',
    is_board_member: true,
    display_order: 5,
    is_active: true,
  },
  {
    _path: 'mark-harrison',
    name: 'Dr. Mark Harrison',
    role: 'Board Director',
    org: 'Industry Representative',
    category: 'Board',
    bio: '<p>Board Director and researcher focused on advanced manufacturing and welding technology. Placeholder bio.</p>',
    is_board_member: true,
    display_order: 6,
    is_active: true,
  },

  // ── Executive & staff ──────────────────────────────────────────────────────
  {
    _path: 'geoff-crittenden',
    name: 'Geoff Crittenden',
    role: 'Chief Executive Officer',
    quals: 'IWE',
    org: 'Weld Australia',
    category: 'Corporate',
    bio: '<p>Leads Weld Australia&rsquo;s work across industry, government and education to strengthen the nation&rsquo;s welding and fabrication capability. Placeholder bio.</p>',
    is_board_member: true,
    display_order: 3,
    is_active: true,
  },
  {
    _path: 'graham-hutt',
    name: 'Dr. Graham Hutt',
    role: 'Technical Director',
    quals: 'IWE, PhD',
    category: 'Engineering',
    bio: '<p>Heads the technical function, guiding members on standards, compliance and welding engineering practice. Placeholder bio.</p>',
    display_order: 11,
    is_active: true,
  },
  {
    _path: 'rhian-gunn',
    name: 'Rhian Gunn',
    role: 'Membership Manager',
    category: 'Corporate',
    bio: '<p>Supports individual and corporate members across the membership lifecycle, from joining through to renewal. Placeholder bio.</p>',
    display_order: 12,
    is_active: true,
  },
  {
    _path: 'michael-hobbs',
    name: 'Dr. Michael Hobbs',
    role: 'Senior Welding Engineer',
    quals: 'IWE, PhD',
    category: 'Engineering',
    bio: '<p>Provides high-level welding engineering support to members across mining, defence, infrastructure and manufacturing. Placeholder bio.</p>',
    display_order: 13,
    is_active: true,
  },
  {
    _path: 'christine-ng',
    name: 'Christine Ng',
    role: 'Training Coordinator',
    category: 'Education & Training',
    bio: '<p>Coordinates the national training calendar, course logistics and candidate support. Placeholder bio.</p>',
    display_order: 14,
    is_active: true,
  },
  {
    _path: 'james-dawson',
    name: 'James Dawson',
    role: 'Welding Engineer',
    quals: 'IWT',
    category: 'Engineering',
    bio: '<p>Works with members on procedure qualification, welder qualification and fabrication quality. Placeholder bio.</p>',
    display_order: 15,
    is_active: true,
  },
  {
    _path: 'sam-oliver',
    name: 'Sam Oliver',
    role: 'Communications Manager',
    category: 'Corporate',
    bio: '<p>Leads communications, publications and member engagement across Weld Australia&rsquo;s channels. Placeholder bio.</p>',
    display_order: 16,
    is_active: true,
  },
  {
    _path: 'anna-fischer',
    name: 'Dr. Anna Fischer',
    role: 'Research Engineer',
    quals: 'IWE, PhD',
    category: 'Q&C',
    bio: '<p>Researches welding technology, automation and quality assurance to support Australian industry. Placeholder bio.</p>',
    display_order: 17,
    is_active: true,
  },
]

// NOTE: each `step` value MUST exactly match one of the canonical ordered
// stages in CERT_META (src/modules/certification-guidance/CertificationGuidance.tsx).
// The progress bar highlights `stages.findIndex(s => s === currentStep)` and the
// guidance lookup filters `step__eq=currentStep`, where currentStep comes from the
// contact's `*_cert_step` property (mirrored from Ollie's Certification pipeline
// stage). All three - CERT_META, these rows, and the pipeline stage names - share
// one vocabulary. Confirm against Ollie's pipeline stage names (CLAUDE.md §13 Q4).
const CERTIFICATION_GUIDANCE: RawRow[] = [
  {
    certification_type: 'AS1796',
    step: 'Application Submitted',
    guidance_text:
      '<p>Your application is being assessed by the AS1796 panel. We will contact you within 10 business days.</p>',
    evidence_checklist:
      '<ul><li>Photo ID</li><li>Trade qualification</li><li>Logbook (last 12 months)</li></ul>',
  },
  {
    certification_type: 'AS1796',
    step: 'Eligibility Review',
    guidance_text:
      '<p>Evidence received. Submit any missing items via your portal upload tile.</p>',
    evidence_checklist:
      '<ul><li>Welding test pieces signed off</li><li>Macro test results</li><li>Employer reference letter</li></ul>',
  },
  {
    certification_type: 'AS1796',
    step: 'Practical Assessment Scheduled',
    guidance_text:
      '<p>Your written and practical examinations are scheduled. Confirm attendance in the calendar invite.</p>',
    evidence_checklist:
      '<ul><li>Bring photo ID on exam day</li><li>Arrive 30 minutes early</li></ul>',
  },
  {
    certification_type: 'IIW Inspector',
    step: 'Training Enrolled',
    guidance_text:
      '<p>All taught modules complete. Your tutor will release the practical assessment booking link.</p>',
    evidence_checklist:
      '<ul><li>Module 1-4 attendance ≥ 95%</li><li>End-of-module quizzes passed</li></ul>',
  },
  {
    certification_type: 'IIW Inspector',
    step: 'Examination Booked',
    guidance_text:
      '<p>Final practical examination day. Bring your inspection toolkit and approved gauges.</p>',
    evidence_checklist:
      '<ul><li>Vernier callipers</li><li>Weld gauges (fillet & butt)</li><li>Lamp & magnifier</li></ul>',
  },
  {
    certification_type: 'ISO 3834',
    step: 'Documentation Review',
    guidance_text:
      '<p>Complete the Stage 1 self-assessment workbook so we can confirm your scope and quality plan.</p>',
    evidence_checklist:
      '<ul><li>Quality manual</li><li>WPS / PQR register</li><li>Welder qualification register</li></ul>',
  },
  {
    certification_type: 'ISO 3834',
    step: 'On-Site Audit Scheduled',
    guidance_text:
      '<p>Your Stage 1 documentation audit is scheduled. Have your QMS evidence ready.</p>',
    evidence_checklist:
      '<ul><li>Document control records</li><li>NCR log</li><li>Internal audit reports</li></ul>',
  },
]

const RESOURCES: RawRow[] = [
  {
    title: 'Australian Welding Standards Overview 2024',
    slug: 'australian-welding-standards-overview-2024',
    abstract:
      '<p>Comprehensive guide to current AS/NZS welding standards applicable to Australian industry.</p>',
    file_url: 'https://example.com/files/aus-welding-standards-2024.pdf',
    file_type: 'pdf',
    category: 'standards',
    required_tier: 'public',
    published_date: isoDate('2024-07-01'),
    is_active: true,
  },
  {
    title: 'Weld Australia Industry Advocacy Position Paper',
    slug: 'industry-advocacy-position-paper',
    abstract:
      '<p>Our formal position on workforce development and trade regulation for the welding industry.</p>',
    file_url: 'https://example.com/files/advocacy-position-paper.pdf',
    file_type: 'pdf',
    category: 'advocacy',
    required_tier: 'public',
    published_date: isoDate('2025-01-15'),
    is_active: true,
  },
  {
    title: 'Members Technical Bulletin - Hydrogen Welding',
    slug: 'members-technical-bulletin-hydrogen-welding',
    abstract:
      '<p>Technical guidance for welding in hydrogen-rich environments. Available to active members.</p>',
    file_url: 'https://example.com/files/hydrogen-welding-bulletin.pdf',
    file_type: 'pdf',
    category: 'technical',
    required_tier: 'member',
    published_date: isoDate('2025-03-10'),
    is_active: true,
  },
  {
    title: 'Infrastructure Welding Case Study - Olympic Dam',
    slug: 'case-study-olympic-dam',
    abstract:
      '<p>How certified welding teams delivered critical infrastructure upgrades under AS 2980.</p>',
    file_url: 'https://example.com/files/case-study-olympic-dam.pdf',
    file_type: 'pdf',
    category: 'case_study',
    required_tier: 'public',
    published_date: isoDate('2024-11-20'),
    is_active: true,
  },
  {
    title: 'State of the Welding Workforce Report 2025',
    slug: 'welding-workforce-report-2025',
    abstract:
      '<p>Annual survey of welding workforce trends, skills gaps, and training pipeline across Australia.</p>',
    file_url: 'https://example.com/files/workforce-report-2025.pdf',
    file_type: 'pdf',
    category: 'report',
    required_tier: 'public',
    published_date: isoDate('2025-02-28'),
    is_active: true,
  },
  {
    title: 'Members Research: Robotic Welding Adoption Study',
    slug: 'robotic-welding-adoption-study',
    abstract:
      '<p>Survey findings on the adoption of robotic and cobot welding among Weld Australia member companies.</p>',
    file_url: 'https://example.com/files/robotic-adoption.pdf',
    file_type: 'pdf',
    category: 'report',
    required_tier: 'member',
    published_date: isoDate('2025-04-01'),
    is_active: true,
  },
  {
    title: 'Skills Shortage Submission to the Senate',
    slug: 'skills-shortage-senate-submission',
    abstract:
      '<p>Weld Australia formal submission on welding trade skills shortages, submitted to the Senate committee.</p>',
    file_url: 'https://example.com/links/senate-submission',
    file_type: 'link',
    category: 'advocacy',
    required_tier: 'public',
    published_date: isoDate('2024-09-05'),
    is_active: true,
  },
  {
    title: 'ISO 3834 Implementation Guide for Fabricators',
    slug: 'iso-3834-implementation-guide',
    abstract:
      '<p>Step-by-step guidance for SME fabricators seeking ISO 3834 certification.</p>',
    file_url: 'https://example.com/files/iso3834-implementation-guide.pdf',
    file_type: 'pdf',
    category: 'technical',
    required_tier: 'member',
    published_date: isoDate('2025-01-10'),
    is_active: true,
  },
]

// Events use a single-state taxonomy. `event_state` is one of the nine values in
// the `events` table's State SELECT (the eight states/territories + National) -
// never a city and never a non-state token like "Online". Anything about the venue
// or an online delivery method belongs in the free-text `event_location`.
const EVENTS: RawRow[] = [
  {
    slug: 'welding-industry-forum-2026',
    event_name: 'Welding Industry Forum 2026',
    event_type: 'Webinar',
    event_state: 'National',
    event_date: isoDate('2026-06-18'),
    event_end_date: isoDate('2026-06-18'),
    event_location: 'Online via Zoom',
    registration_url: 'https://events.weldaustralia.com.au/forum-2026',
    event_description:
      '<p>Quarterly online forum covering standards updates, advocacy news and Q&A with the Weld Australia team.</p>',
    is_featured: true,
    is_members_only: false,
  },
  {
    slug: 'nsw-members-networking-evening',
    event_name: 'NSW Members Networking Evening',
    event_type: 'In-Person',
    event_state: 'NSW',
    event_date: isoDate('2026-07-09'),
    event_end_date: isoDate('2026-07-09'),
    event_location: 'Sydney Olympic Park',
    registration_url: 'https://events.weldaustralia.com.au/nsw-networking-jul26',
    event_description:
      '<p>An informal networking evening for NSW members. Includes a short tour of the Olympic Park welding centre.</p>',
    is_featured: false,
    is_members_only: true,
  },
  {
    slug: 'resources-energy-welding-summit',
    event_name: 'Resources & Energy Welding Summit',
    event_type: 'Hybrid',
    event_state: 'WA',
    event_date: isoDate('2026-08-26'),
    event_end_date: isoDate('2026-08-27'),
    event_location: 'Perth Convention Centre + Online',
    registration_url: 'https://events.weldaustralia.com.au/resources-energy-summit',
    event_description:
      '<p>Two-day summit on welding for the resources and energy sectors - mining, LNG, hydrogen and offshore.</p>',
    is_featured: true,
    is_members_only: false,
  },
  {
    slug: 'australian-welding-awards-2026',
    event_name: 'Australian Welding Awards 2026',
    event_type: 'Awards',
    event_state: 'National',
    event_date: isoDate('2026-10-23'),
    event_end_date: isoDate('2026-10-23'),
    event_location: 'Melbourne Convention Centre',
    registration_url: 'https://events.weldaustralia.com.au/awards-2026',
    event_description:
      '<p>Annual industry awards recognising excellence in welding, fabrication and inspection.</p>',
    is_featured: true,
    is_members_only: false,
  },
  {
    slug: 'cobot-welding-demo-day',
    event_name: 'Cobot Welding Demo Day',
    event_type: 'In-Person',
    event_state: 'VIC',
    event_date: isoDate('2026-09-15'),
    event_end_date: isoDate('2026-09-15'),
    event_location: 'Weld Australia Technology Centre, Melbourne',
    registration_url: 'https://events.weldaustralia.com.au/cobot-demo-sep26',
    event_description:
      '<p>Hands-on demonstration of collaborative welding robots from Universal Robots, ABB and Yaskawa.</p>',
    is_featured: false,
    is_members_only: false,
  },
]

const JOBS: RawRow[] = [
  {
    title: 'Senior Welding Inspector',
    slug: 'senior-welding-inspector-sydney',
    company_name: 'Southern Cross Fabrication',
    location_state: 'NSW',
    location_city: 'Sydney',
    employment_type: 'full_time',
    category: 'inspection',
    summary:
      'Lead inspector role on a major rail infrastructure project. IIW Comprehensive (IWI-C) required.',
    description_richtext:
      '<p>Lead inspection across a major rail-bridge fabrication programme. You will run NDT scheduling, manage two junior inspectors and report into the QA Manager.</p>',
    apply_link: 'mailto:jobs@example.com?subject=Senior%20Welding%20Inspector',
    posted_date: isoDate('2026-05-10'),
    expires_date: isoDate('2026-07-10'),
    is_active: true,
  },
  {
    title: 'Welding Supervisor - Pilbara Site',
    slug: 'welding-supervisor-pilbara',
    company_name: 'Pilbara Heavy Industries',
    location_state: 'WA',
    location_city: 'Karratha',
    employment_type: 'contract',
    category: 'supervision',
    summary:
      '6-month FIFO contract overseeing structural fabrication on a major resource project. AS1796 Cert 10 required.',
    description_richtext:
      '<p>FIFO 3:1 roster from Perth. Oversee welder qualification, WPS / PQR adherence and daily toolbox meetings.</p>',
    apply_link: 'mailto:jobs@example.com?subject=Welding%20Supervisor%20Pilbara',
    posted_date: isoDate('2026-05-08'),
    expires_date: isoDate('2026-06-30'),
    is_active: true,
  },
  {
    title: 'Apprentice Welder',
    slug: 'apprentice-welder-melbourne',
    company_name: 'Murray-Darling Engineering',
    location_state: 'VIC',
    location_city: 'Melbourne',
    employment_type: 'apprenticeship',
    category: 'welding',
    summary:
      '1st-year apprenticeship in a structural-and-pipework job shop. Group training available.',
    description_richtext:
      '<p>Join a small team learning MIG, TIG and stick welding on structural and pipework jobs. Block release at a TAFE in the Melbourne metro area.</p>',
    apply_link: 'mailto:jobs@example.com?subject=Apprentice%20Welder',
    posted_date: isoDate('2026-05-12'),
    expires_date: isoDate('2026-07-12'),
    is_active: true,
  },
  {
    title: 'Quality Control Welder',
    slug: 'qc-welder-brisbane',
    company_name: 'Capricorn Coast Welders',
    location_state: 'QLD',
    location_city: 'Brisbane',
    employment_type: 'full_time',
    category: 'welding',
    summary:
      'Workshop-based QC welder for a busy fabricator. Pressure-vessel experience preferred.',
    description_richtext:
      '<p>Sign off welder qualifications and complete first-off inspection on pressure-vessel work for the resources sector.</p>',
    apply_link: 'mailto:jobs@example.com?subject=QC%20Welder',
    posted_date: isoDate('2026-04-22'),
    expires_date: isoDate('2026-06-22'),
    is_active: true,
  },
  {
    title: 'National Training Manager',
    slug: 'national-training-manager',
    company_name: 'Weld Australia',
    location_state: 'National',
    location_city: 'Flexible (HQ in Sydney)',
    employment_type: 'full_time',
    category: 'training',
    summary:
      'Lead the national training calendar across IIW, AS1796 and short-course programmes.',
    description_richtext:
      '<p>Own the end-to-end training delivery for Weld Australia - including the IIW Inspector and AS1796 Cert 10 sales channels.</p>',
    apply_link: 'mailto:jobs@example.com?subject=National%20Training%20Manager',
    posted_date: isoDate('2026-05-01'),
    expires_date: isoDate('2026-06-15'),
    is_active: true,
  },
]

const STATE_OFFICES: RawRow[] = [
  {
    state: 'NSW',
    office_name: 'Weld Australia HQ - Sydney',
    address: 'Suite 5, Level 3, 123 Test Street, Sydney NSW 2000',
    phone: '(02) 0000 0000',
    email: 'nsw@example.com',
  },
  {
    state: 'VIC',
    office_name: 'Weld Australia Victoria',
    address: 'Level 2, 456 Demo Road, Melbourne VIC 3000',
    phone: '(03) 0000 0000',
    email: 'vic@example.com',
  },
  {
    state: 'QLD',
    office_name: 'Weld Australia Queensland',
    address: 'Unit 7, 789 Sample Avenue, Brisbane QLD 4000',
    phone: '(07) 0000 0000',
    email: 'qld@example.com',
  },
  {
    state: 'WA',
    office_name: 'Weld Australia Western Australia',
    address: 'Level 1, 101 Placeholder Highway, Perth WA 6000',
    phone: '(08) 0000 0000',
    email: 'wa@example.com',
  },
  {
    state: 'SA',
    office_name: 'Weld Australia South Australia',
    address: 'Suite 12, 202 Example Terrace, Adelaide SA 5000',
    phone: '(08) 0000 0000',
    email: 'sa@example.com',
  },
]

/**
 * Demo course rows carry a city; their state is derived from it rather than
 * typed out per row, which is also what `pnpm backfill:course-state` does to
 * the real rows. A city the map doesn't know is left blank so the seeded data
 * matches what the backfill would leave behind.
 */
const COURSES_WITH_STATE: RawRow[] = COURSES.map((row) => {
  const state = stateForCity(row.city as string | undefined)
  return state ? { ...row, state } : row
})

const DEMO_DATA: Array<{ table: string; rows: RawRow[] }> = [
  { table: 'courses', rows: COURSES_WITH_STATE },
  { table: 'members', rows: MEMBERS },
  { table: 'team_and_board', rows: TEAM_AND_BOARD },
  { table: 'certification_guidance', rows: CERTIFICATION_GUIDANCE },
  { table: 'resources', rows: RESOURCES },
  { table: 'events', rows: EVENTS },
  { table: 'jobs', rows: JOBS },
  { table: 'state_offices', rows: STATE_OFFICES },
]

// ---------------------------------------------------------------------------
// Value encoding (raw JSON -> HubDB V3 row values)
// ---------------------------------------------------------------------------

function findOption(column: any, name: string): any | null {
  if (!column.options) return null
  return column.options.find((o: any) => o.name === name || o.label === name) ?? null
}

function encodeValue(raw: unknown, column: any, tableName: string): unknown {
  if (raw === null || raw === undefined) return null
  const type = String(column.type).toUpperCase()
  switch (type) {
    case 'DATE':
    case 'DATETIME':
      return typeof raw === 'string' ? Date.parse(raw) : raw
    case 'BOOLEAN':
      return raw === true || raw === 1 || raw === '1' ? 1 : 0
    case 'SELECT': {
      const opt = findOption(column, String(raw))
      if (!opt) {
        console.warn(
          `  ⚠️  ${tableName}.${column.name}: option "${raw}" not found in table schema - skipping`,
        )
        return null
      }
      return { id: opt.id, name: opt.name, type: 'option' }
    }
    case 'MULTISELECT': {
      if (!Array.isArray(raw)) return null
      const resolved = raw
        .map((v) => {
          const opt = findOption(column, String(v))
          if (!opt) {
            console.warn(
              `  ⚠️  ${tableName}.${column.name}: option "${v}" not found in table schema - skipping`,
            )
            return null
          }
          return { id: opt.id, name: opt.name, type: 'option' }
        })
        .filter(Boolean)
      return resolved
    }
    default:
      return raw
  }
}

function rowToValues(
  raw: RawRow,
  columnsByName: Record<string, any>,
  tableName: string,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (key.startsWith('_')) continue
    const column = columnsByName[key]
    if (!column) {
      console.warn(`  ⚠️  ${tableName}: column "${key}" not in table schema - skipping`)
      continue
    }
    const encoded = encodeValue(val, column, tableName)
    if (encoded === null || encoded === undefined) continue
    values[key] = encoded
  }
  return values
}

// ---------------------------------------------------------------------------
// HubSpot wiring
// ---------------------------------------------------------------------------

function is404(err: any): boolean {
  return err?.code === 404 || err?.statusCode === 404 || err?.response?.statusCode === 404
}

async function getTable(name: string): Promise<any | null> {
  try {
    return await tablesApi.getDraftTableDetailsById(name, undefined, true)
  } catch (err: any) {
    if (is404(err)) return null
    throw err
  }
}

/**
 * Re-assert allowPublicApiAccess from hubdb/<name>.json before rows land.
 * Changing the JSON alone does not flip privacy on an already-seeded table.
 */
async function enforceTablePrivacy(tableName: string, table: any): Promise<void> {
  const schemaPath = join(resolve(process.cwd(), 'hubdb'), `${tableName}.json`)
  if (!existsSync(schemaPath)) return

  let wanted: boolean | undefined
  try {
    const def = JSON.parse(readFileSync(schemaPath, 'utf-8')) as {
      allowPublicApiAccess?: boolean
    }
    wanted = def.allowPublicApiAccess
  } catch {
    return
  }
  if (wanted === undefined) return

  const current = Boolean(table.allowPublicApiAccess)
  if (current === Boolean(wanted)) {
    console.log(`  allowPublicApiAccess already ${wanted}`)
    return
  }

  console.log(`  allowPublicApiAccess: ${current} → ${wanted} (before seeding rows)`)
  if (dryRun) return

  await tablesApi.updateDraftTable(table.id, {
    name: table.name,
    label: table.label,
    useForPages: table.useForPages ?? false,
    allowChildTables: table.allowChildTables ?? false,
    enableChildTablePages: table.enableChildTablePages ?? false,
    allowPublicApiAccess: wanted,
    columns: table.columns ?? [],
  })
  await tablesApi.publishDraftTable(table.id, undefined)
  console.log(`  published privacy update ✓ ${tableName}`)
}

async function purgeAllDraftRows(tableName: string): Promise<number> {
  // The draft endpoint paginates; loop until we've collected everything.
  const ids: string[] = []
  let after: string | undefined
  while (true) {
    const page: any = await rowsApi.readDraftTableRows(
      tableName,
      undefined,
      after,
      1000,
      undefined,
      undefined,
      undefined,
    )
    for (const row of page.results ?? []) ids.push(String(row.id))
    after = page.paging?.next?.after
    if (!after) break
  }
  if (ids.length === 0) return 0
  if (dryRun) return ids.length

  // Batch purge - max 100 IDs per call.
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100)
    await rowsBatchApi.purgeDraftTableRows(tableName, { inputs: slice })
  }
  return ids.length
}

async function seedTable(tableName: string, rawRows: RawRow[]): Promise<{
  purged: number
  created: number
}> {
  console.log(`\n[seed-hubdb-demo] → ${tableName}`)

  const table = await getTable(tableName)
  if (!table) {
    throw new Error(
      `table "${tableName}" not found - run \`pnpm seed:hubdb --env=${env}\` first to create schemas`,
    )
  }

  // Lock private tables BEFORE any row writes so employer emails (jobs) and
  // similar sensitive columns cannot leak via the public HubDB API.
  await enforceTablePrivacy(tableName, table)

  const columnsByName: Record<string, any> = {}
  for (const c of table.columns ?? []) columnsByName[c.name] = c

  let purged = 0
  if (!noPurge) {
    purged = await purgeAllDraftRows(tableName)
    console.log(`  purged ${purged} existing draft row(s)${dryRun ? ' [dry-run]' : ''}`)
  } else {
    console.log(`  --no-purge set; keeping existing rows`)
  }

  const inputs = rawRows.map((raw) => {
    // `name` and `path` are HubDB's built-in row fields, distinct from any `name`
    // *column* a table happens to define. On a dynamic-page table they are the
    // page title and the URL segment, so a row that sets a path should always set
    // a name too - otherwise the row lists as untitled in HubDB and the generated
    // page has no built-in title. Fall back to the row's own `name` column value.
    const rowName =
      raw._name ??
      (raw._path && typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined)

    return {
      values: rowToValues(raw, columnsByName, tableName),
      ...(rowName ? { name: rowName } : {}),
      ...(raw._path ? { path: raw._path } : {}),
    }
  })

  if (dryRun) {
    console.log(`  [dry-run] would create ${inputs.length} row(s)`)
    return { purged, created: inputs.length }
  }

  // Batch-create rows - max 100 per call.
  let created = 0
  for (let i = 0; i < inputs.length; i += 100) {
    const slice = inputs.slice(i, i + 100)
    const resp: any = await rowsBatchApi.createDraftTableRows(tableName, { inputs: slice })
    created += resp.results?.length ?? slice.length
  }
  console.log(`  created ${created} row(s)`)

  await tablesApi.publishDraftTable(tableName, undefined)
  console.log(`  published ✓ ${tableName}`)
  return { purged, created }
}

async function main(): Promise<void> {
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[seed-hubdb-demo]',
  })
  const client = new Client({ accessToken: auth.accessToken })
  tablesApi = client.cms.hubdb.tablesApi
  rowsApi = client.cms.hubdb.rowsApi
  rowsBatchApi = client.cms.hubdb.rowsBatchApi

  console.log(
    `[seed-hubdb-demo] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `dryRun=${dryRun} noPurge=${noPurge}` +
      (onlyTable ? ` only=${onlyTable}` : ''),
  )

  const summary: Record<string, { purged: number; created: number }> = {}
  let failed = 0
  for (const { table, rows } of DEMO_DATA) {
    if (onlyTable && onlyTable !== table) continue
    try {
      summary[table] = await seedTable(table, rows)
    } catch (err) {
      failed++
      console.error(`[seed-hubdb-demo] ✖ ${table} failed:`, err)
    }
  }

  console.log(`\n[seed-hubdb-demo] summary:`)
  for (const [table, s] of Object.entries(summary)) {
    console.log(`  ${table}: purged ${s.purged}, created ${s.created}`)
  }

  if (failed) {
    console.error(`\n[seed-hubdb-demo] done with ${failed} failure(s).`)
    process.exit(1)
  }
  console.log(`\n[seed-hubdb-demo] done.`)
}

main().catch((err) => {
  console.error('[seed-hubdb-demo] unexpected error:', err)
  process.exit(1)
})
