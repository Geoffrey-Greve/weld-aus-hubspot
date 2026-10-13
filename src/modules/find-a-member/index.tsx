/**
 * find-a-member - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="find-a-member" data-props="<json>"></div>
 *
 * Props (FindAMemberProps) are serialised from HubL into data-props.
 * See theme/modules/find-a-member.module/module.html for the HubL source.
 */

import { FindAMember } from './FindAMember'
import mountReactIsland from '@shared/mount'

mountReactIsland('find-a-member', FindAMember)
