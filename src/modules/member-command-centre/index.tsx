/**
 * member-command-centre - staging dashboard preview inspired by the supplied
 * Weld Australia member dashboard prototype.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="member-command-centre" data-props="<json>"></div>
 */

import mountReactIsland from '@shared/mount'
import { MemberCommandCentre } from './MemberCommandCentre'

mountReactIsland('member-command-centre', MemberCommandCentre)
