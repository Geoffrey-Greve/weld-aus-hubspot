# Job Board - application routing (defect 68)

> **Owner:** Ryan Jones (frontend)
> **Last updated:** 2026-08-02

## The problem

Employers advertising on the Jobs Board often take applications by email. A bare
`mailto:` in the page source invites harvesting. Routing every applicant through
Weld Australia's generic Contact Us page (or an unfinished HubSpot form) is worse
UX than emailing the employer directly.

## Current approach (shipped)

Basic JS obfuscation - good enough until a real application system is scoped:

1. `hubdb/jobs.json` keeps `allowPublicApiAccess: false` so addresses are not
   readable via the public HubDB API. Re-assert with `pnpm seed:hubdb` if the
   live table drifts.
2. `theme/templates/partials/_job-apply.html` resolves each row to `url` /
   `email` / `none`.
3. For `email` mode, Apply CTAs emit split attributes only:
   `data-job-apply-u` (local) + `data-job-apply-d` (domain) + optional subject.
   No contiguous address and no `mailto:` appear in the HTML source.
4. `theme/templates/partials/_job-apply-script.html` joins those parts on click
   and opens the visitor's mail client.
5. Without JS, the link still goes to `/job-board/{slug}#apply` as a fallback.
6. `none` mode (no URL, no email) still falls back to
   `/contact-us?topic=job-board`.

This is deliberately light protection. Determined scrapers can still reassemble
the address; the goal is to stop casual harvesting from static HTML / simple
regexes, not to build anti-spam infrastructure.

## Deferred - full application system

The `job-apply-form` module and the HubSpot form + workflow sketched previously
remain in the repo but are **not wired**. When Weld Australia wants applicants
to apply through the site (CV upload, CRM logging, employer forwarding without
publishing the address), expand scope to:

1. A HubSpot application form with hidden `job_slug` / `job_title` /
   `job_reference` / `employer_name` fields.
2. A workflow that looks up `application_email` from HubDB and forwards the
   submission.
3. Replacing the obfuscated mailto CTAs with that form on the job detail page.

Until then, leave Apply as a direct (obfuscated) email to the employer.
