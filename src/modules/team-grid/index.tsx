/**
 * team-grid - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="team-grid" data-props="<json>"></div>
 *
 * Props (TeamGridProps) are serialised from HubL into data-props.
 * See theme/modules/team-grid.module/module.html for the HubL source.
 */

import { TeamGrid } from './TeamGrid'
import mountReactIsland from '@shared/mount'

mountReactIsland('team-grid', TeamGrid)
