/**
 * course-filter - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="course-filter" data-props="<json>"></div>
 *
 * Props (CourseFilterProps) are serialised from HubL into data-props.
 * See theme/modules/course-filter.module/module.html for the HubL source.
 */

import { CourseFilter } from './CourseFilter'
import mountReactIsland from '@shared/mount'

mountReactIsland('course-filter', CourseFilter)
