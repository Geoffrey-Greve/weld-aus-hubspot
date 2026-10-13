/**
 * Shared UI components barrel export.
 *
 * Import from '@shared/components' rather than individual files
 * so import paths stay stable as the component library grows.
 */

export { Button, type ButtonProps } from './Button'
export { Card, type CardProps } from './Card'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { Filter, type FilterProps, type FilterOption } from './Filter'
export { Modal, type ModalProps } from './Modal'
export { Pagination, type PaginationProps } from './Pagination'
export { LoadingSkeleton, SkeletonCard, type LoadingSkeletonProps } from './LoadingSkeleton'
export { default as ErrorBoundary } from './ErrorBoundary'
