/**
 * member-dashboard - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="member-dashboard" data-props="<json>"></div>
 *
 * Props (DashboardProps) are serialised from HubL into data-props.
 * Member contact/certification data comes from window.__WELD_MEMBER__
 * which is injected by portal.html for every logged-in member.
 */

import { Dashboard } from './Dashboard'
import mountReactIsland from '@shared/mount'

mountReactIsland('member-dashboard', Dashboard)
