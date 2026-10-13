/**
 * jobs-listing - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="jobs-listing" data-props="<json>"></div>
 *
 * Props (JobsListingProps) are serialised from HubL into data-props.
 * See theme/modules/jobs-listing.module/module.html for the HubL source.
 */

import { JobsListing } from './JobsListing'
import mountReactIsland from '@shared/mount'

mountReactIsland('jobs-listing', JobsListing)
