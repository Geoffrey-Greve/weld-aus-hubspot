# Find a Member - Member Logo Guidance

**Audience:** Weld Australia (Danielle / Ben) + whoever maintains the HubDB `members` directory.
**Context:** Answer to QA issue #99 ("advise what logo file formats and sizes are permitted?")
and mitigation for #96 ("some logo images broken").

## Recommendation (what to tell Weld Australia)

Accept **PNG or JPG only**.

| Attribute | Recommendation |
|---|---|
| Format | **PNG** (preferred - supports transparent background) or **JPG** (for photographic logos) |
| **No SVG** | Do not accept SVG uploads (see rationale below) |
| Colour space | RGB |
| Longest edge | ~**400px** is plenty (the directory renders logos in an 80×80 box; we serve a 160px 2× version) |
| Background | Transparent PNG preferred so the logo sits cleanly on the card's light surface |
| File size | Keep under ~200KB; HubSpot's built-in image optimisation handles the rest |

## Why no SVG

SVG is XML and can carry embedded scripts/external references, so accepting arbitrary
uploaded SVGs is a stored-XSS surface. Sanitising SVGs safely is extra work with ongoing
risk. Since logos only ever display in a small raster box, PNG/JPG lose nothing here.
Standardising on PNG/JPG removes the risk entirely.

## How the build handles logos

- **Optimisation:** `theme/modules/find-a-member.module/module.html` passes each logo URL
  through HubSpot's `resize_image_url(url, 160)` so directory logos are served at 2× the
  80px display box (crisp on retina) and never ship oversized originals.
- **Broken-image fallback (#96):** `src/modules/find-a-member/FindAMember.tsx` (`MemberCard`)
  renders an `onError` handler on the logo `<img>`. If a logo URL is missing **or** fails to
  load (404 / removed asset), the card falls back to the company's initials placeholder
  instead of a broken-image icon.

## Fixing existing broken logos

The fallback prevents broken icons, but a member showing initials instead of their logo
means the source image in HubDB is missing or dead. To restore an actual logo:

1. Open the `members` HubDB table (or the source Company record `directory_logo_url`).
2. Re-upload the logo as PNG/JPG per the table above.
3. Republish - the directory reflects the change on the next page render (HubDB cache TTL).
