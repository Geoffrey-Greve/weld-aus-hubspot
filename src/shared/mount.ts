/**
 * mountReactIsland - React-island mount helper.
 *
 * Usage:
 *   mountReactIsland('course-filter', CourseFilter)
 *
 * HubL adds `data-wa-module="<name>"` and either `data-props="<json>"` or a
 * child `<script type="application/json" data-props-json>` to a div.
 * This helper finds every matching element, parses the props, and mounts
 * the React component using React 18 createRoot.
 *
 * Roots are tracked in a WeakMap so they can be unmounted when their
 * host element is removed from the DOM (watched via MutationObserver).
 */

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** WeakMap from mount element → React Root, so we can unmount on removal. */
interface MountedRoot {
  root: Root
  rawProps: string
}

const rootMap = new WeakMap<Element, MountedRoot>()

/**
 * Mount a React component onto every `<div data-wa-module="<name>">` element
 * currently in the DOM (and any added later via re-calling the function).
 *
 * @param name      The value of the `data-wa-module` attribute to match.
 * @param Component The React component to mount; receives props from `data-props`.
 */
export function mountReactIsland<P extends object>(
  name: string,
  Component: React.ComponentType<P>
): void {
  const doMount = () => {
    const selector = `[data-wa-module="${name}"]`
    const elements = document.querySelectorAll(selector)

    elements.forEach((el) => {
      let props: P = {} as P
      const raw =
        (el as HTMLElement).dataset.props ||
        el.querySelector<HTMLScriptElement>('script[type="application/json"][data-props-json]')?.textContent ||
        ''
      if (raw) {
        try {
          props = JSON.parse(raw) as P
        } catch (err) {
          console.error(
            `[wa-island] Failed to parse data-props for module "${name}":`,
            err,
            '\nRaw value:',
            raw
          )
          return
        }
      }

      const mounted = rootMap.get(el)
      if (mounted) {
        const wasClearedByEditor = el.childNodes.length === 0
        if (mounted.rawProps !== raw || wasClearedByEditor) {
          mounted.root.render(React.createElement(Component, props))
          mounted.rawProps = raw
        }
        return
      }

      const root = createRoot(el)
      root.render(React.createElement(Component, props))
      rootMap.set(el, { root, rawProps: raw })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doMount, { once: true })
  } else {
    doMount()
  }

  // Watch for removed nodes so we can unmount their React roots
  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    let shouldMount = false

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        shouldMount = true
        continue
      }

      mutation.removedNodes.forEach((node) => {
        if (!(node instanceof Element)) return

        // Check the node itself
        const mountedForNode = rootMap.get(node)
        if (mountedForNode) {
          mountedForNode.root.unmount()
          rootMap.delete(node)
        }

        // Check descendants
        const selector = `[data-wa-module="${name}"]`
        node.querySelectorAll(selector).forEach((descendant) => {
          const mountedForDescendant = rootMap.get(descendant)
          if (mountedForDescendant) {
            mountedForDescendant.root.unmount()
            rootMap.delete(descendant)
          }
        })
      })

      if (mutation.addedNodes.length > 0) {
        shouldMount = true
      }
    }

    if (shouldMount) doMount()
  })

  observer.observe(document.body, {
    attributeFilter: ['data-props'],
    attributes: true,
    childList: true,
    subtree: true,
  })
}

export default mountReactIsland
