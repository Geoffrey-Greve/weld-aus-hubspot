import { createRoot } from 'react-dom/client'
import { CorporateAdmin } from './CorporateAdmin'
import type { CorporateAdminProps } from './CorporateAdmin'

const el = document.querySelector<HTMLElement>('[data-wa-module="corporate-admin"]')
if (el) {
  const props = JSON.parse(el.dataset.props ?? '{}') as CorporateAdminProps
  createRoot(el).render(<CorporateAdmin {...props} />)
}
