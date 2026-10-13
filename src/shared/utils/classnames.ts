/**
 * cx - lightweight classname joiner.
 *
 * Joins truthy string arguments with a space. Falsy values (false, null,
 * undefined, empty string) are filtered out. No external dependency required.
 *
 * @example
 *   cx('wa-btn', 'wa-btn--primary', isLoading && 'wa-btn--loading')
 *   // → "wa-btn wa-btn--primary" (when isLoading is false)
 *   // → "wa-btn wa-btn--primary wa-btn--loading" (when isLoading is true)
 */
export function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ')
}

export default cx
