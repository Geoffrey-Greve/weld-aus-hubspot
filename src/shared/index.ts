/**
 * Shared package barrel export.
 *
 * Import shared utilities, API clients, components, and design tokens from
 * '@shared' in any React island. Tree-shaking ensures only used exports land
 * in each island's bundle.
 */

export { mountReactIsland } from './mount'
export { default as mountReactIslandDefault } from './mount'

export {
  trackCustomEvent,
  pushDataLayer,
  type CustomEventPayload,
} from './api/events'

export {
  fetchHubDbRows,
  type HubDbRow,
  type HubDbResponse,
  type HubDbQueryParams
} from './api/hubdb'

export { submitHubSpotForm, type FormSubmission } from './api/forms'

export { validateMemberCompany, type MemberCompany } from './api/members'

export {
  getMemberContext,
  useMemberContext,
  isMember,
  hasTier,
  type MembershipTier,
  type MembershipStatus,
  type MemberContact,
  type MemberAssociation,
  type MemberCertification,
  type MemberEntitlements,
  type WeldMemberContext
} from './api/memberContext'

export {
  Button,
  Card,
  EmptyState,
  Filter,
  Modal,
  Pagination,
  LoadingSkeleton,
  SkeletonCard,
  ErrorBoundary,
  type ButtonProps,
  type CardProps,
  type EmptyStateProps,
  type FilterProps,
  type FilterOption,
  type ModalProps,
  type PaginationProps,
  type LoadingSkeletonProps
} from './components'

export { formatCurrency, formatCurrencyDollars, formatDate, formatDateShort, formatDateRange, debounce, cx } from './utils'

export { TOKENS, BREAKPOINTS, type Breakpoint } from './design-tokens'

export {
  COURSE_CATEGORY_BUCKETS,
  COURSE_CATEGORY_FALLBACK_SLUG,
  COURSE_CATEGORY_FALLBACK_LABEL,
  bucketForCategory,
  bucketLabel,
  normaliseCategoryKey,
  resolveBucketFromParam,
  type CourseCategoryBucket
} from './courseTaxonomy'
