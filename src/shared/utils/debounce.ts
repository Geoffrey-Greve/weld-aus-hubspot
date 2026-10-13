/**
 * debounce - delays function invocation until after `wait` milliseconds of inactivity.
 *
 * Used in search/filter inputs across HubDB-driven listing modules to avoid
 * firing client-side filtering on every keystroke.
 *
 * The returned function has a `cancel()` method to clear any pending invocation.
 *
 * @example
 *   const debouncedSearch = debounce((query: string) => filter(query), 300)
 *   input.addEventListener('input', (e) => debouncedSearch(e.target.value))
 *   // Later: debouncedSearch.cancel()
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number
): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined

  const debounced = (...args: unknown[]) => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, wait)
  }

  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  return debounced as T & { cancel: () => void }
}

export default debounce
