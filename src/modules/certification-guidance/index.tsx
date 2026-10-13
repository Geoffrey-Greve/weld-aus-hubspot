/**
 * certification-guidance - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="certification-guidance" data-props="<json>"></div>
 *
 * Props (CertificationGuidanceProps) come from data-props (HubL-serialised).
 * Cert status / currentStep come from window.__WELD_MEMBER__.certifications.
 * Guidance text is fetched at runtime from HubDB Table 4 (certification_guidance).
 */

import { CertificationGuidance } from './CertificationGuidance'
import mountReactIsland from '@shared/mount'

mountReactIsland('certification-guidance', CertificationGuidance)
