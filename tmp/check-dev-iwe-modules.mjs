import fs from 'node:fs'
import path from 'node:path'
import yaml from '../.tools/hubspot-cli/node_modules/js-yaml/index.js'

const config = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, '.hscli', 'config.yml'), 'utf8'))
const dev = config.accounts.find((entry) => entry.name === 'weld-australia-sandbox')
const headers = { Authorization: `Bearer ${dev.auth.tokenInfo.accessToken}` }
const get = async (pathname) => {
  const response = await fetch(`https://api.hubapi.com${pathname}`, { headers })
  if (!response.ok) throw new Error(`${pathname}: ${response.status}`)
  return response.json()
}
const courses = await get('/cms/v3/hubdb/tables/courses/rows?course_slug=iwe&limit=10')
const course = (courses.results ?? []).find((row) => row.values?.course_slug === 'iwe' && row.path === 'iwe')
const modules = await get('/cms/v3/hubdb/tables/course_modules/rows?limit=100')
const courseId = course?.values?.course_id
const matches = (modules.results ?? []).filter((row) => String(row.values?.parent_course_id) === String(courseId))
console.log(JSON.stringify({
  courseFound: Boolean(course),
  courseId,
  parentTemplate: course?.values?.parent_template,
  matchingModules: matches.length,
  visibleModules: matches.filter((row) => row.values?.show_on_website === true).length,
}, null, 2))
