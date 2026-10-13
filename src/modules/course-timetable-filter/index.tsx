/**
 * course-timetable-filter - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="course-timetable-filter" data-props="<json>"></div>
 *
 * Props (CourseTimetableFilterProps) are serialised from HubL into data-props.
 * See theme/modules/course-timetable-filter.module/module.html for the HubL source.
 */

import { CourseTimetableFilter } from './CourseTimetableFilter'
import mountReactIsland from '@shared/mount'

mountReactIsland('course-timetable-filter', CourseTimetableFilter)
