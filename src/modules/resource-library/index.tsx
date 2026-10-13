/**
 * resource-library - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="resource-library" data-props="<json>"></div>
 *
 * Props (ResourceLibraryProps) are serialised from HubL into data-props,
 * including a server-computed `locked` boolean per row.
 * See theme/modules/resource-library.module/module.html for the HubL source.
 */

import { ResourceLibrary } from './ResourceLibrary'
import mountReactIsland from '@shared/mount'

mountReactIsland('resource-library', ResourceLibrary)
