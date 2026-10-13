/**
 * profile-switcher entry point - mounts the standalone header island.
 *
 * The mount element is rendered by header.module/module.html (inside the
 * logged-in block). The component self-hides when the member has < 2 contexts,
 * so it is safe to load on all portal pages.
 *
 * window.__WELD_MEMBER__ must be injected before this script runs.
 * portal.html guarantees that via a <script> block in <head>.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ProfileSwitcher } from './ProfileSwitcher'

const mount = document.querySelector('[data-wa-module="profile-switcher"]')
if (mount instanceof HTMLElement) {
  createRoot(mount).render(
    <React.StrictMode>
      <ProfileSwitcher />
    </React.StrictMode>
  )
}
