/**
 * events-listing - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="events-listing" data-props="<json>"></div>
 *
 * Props (EventsListingProps) are serialised from HubL into data-props.
 * See theme/modules/events-listing.module/module.html for the HubL source.
 */

import { EventsListing } from './EventsListing'
import mountReactIsland from '@shared/mount'

mountReactIsland('events-listing', EventsListing)
