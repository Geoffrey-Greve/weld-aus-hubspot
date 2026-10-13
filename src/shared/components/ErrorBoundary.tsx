/**
 * ErrorBoundary - class component that catches render errors in its subtree.
 *
 * Used to wrap React islands so a single tile/module failure does not crash
 * the entire page. Renders a fallback if provided, otherwise shows a generic
 * "Something went wrong" message.
 */

import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[wa-island] ErrorBoundary caught an error:', error, info)
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback
      }
      return (
        <div className="wa-error-boundary">
          <p>Something went wrong.</p>
          {this.state.error && (
            <p className="wa-error-boundary__message">{this.state.error.message}</p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
