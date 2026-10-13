export interface CourseItem {
  deal_id: string
  course_name: string
  course_date: string | null
  course_end_date: string | null
  location: string
  course_category: string
  completion_certificate_url: string | null
  registration_url: string | null
}

export interface MyCoursesProps {
  courses: CourseItem[]
  empty_state_message: string
  browse_url: string
  support_email: string
}
