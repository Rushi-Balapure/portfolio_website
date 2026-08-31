# Portfolio Website Plan

## Implementation Status

The initial implementation was completed on 2026-08-31 on branch `build/initial_build`.

- [x] Phase 1: Astro 7, strict TypeScript, MDX, and project foundation.
- [x] Phase 2: Validated Markdown collections and editable draft placeholders.
- [x] Phase 3: Responsive visual system, header, footer, cards, and layouts.
- [x] Phase 4: Archive and generated detail routes for every content section.
- [x] Phase 5: Homepage composition, motion, and GitHub contribution calendar.
- [x] Phase 6: SEO, RSS, sitemap, GitHub Actions, Pages deployment, and build verification.

The application builds cleanly with Node.js 22. The remaining launch work is content and configuration: replace draft placeholders, complete `home.md`, provide the production domain, add `public/CNAME`, configure repository variables, and review the populated site on mobile and desktop.

## Goal

Build a minimal, fast, Markdown-driven portfolio that presents professional experience, projects, open-source work, community involvement, speaking sessions, publications, education, and blogs.

The site will target recruiters and technical collaborators equally. It will be statically generated, hosted on GitHub Pages, deployed through GitHub Actions, and connected to a custom domain.

## Sections

1. **Home**: A concise overview with featured content from every section.
2. **Experience**: Professional roles, internships, responsibilities, and measurable impact.
3. **Projects**: A single unified collection of projects without personal, academic, professional, or other subtype distinctions.
4. **Open Source**: Contributions, maintained repositories, pull requests, impact, and a live GitHub activity bar.
5. **Community & Speaking**: A single unified collection for community work, sessions, workshops, mentoring, and organizing, without separating entries by subtype.
6. **Publications**: Research papers, conference papers, publication details, DOI links, and citation information.
7. **Blogs**: Technical articles, tutorials, notes, and other long-form posts.
8. **Education**: Degrees, institutions, academic background, and relevant achievements.
9. **About**: Personal story, skills, interests, and current focus.
10. **Contact**: Email, GitHub, LinkedIn, and other relevant social links.

Experience will appear immediately after the homepage hero and will be the first content section in the primary navigation. Contact will primarily be a homepage section and persistent call to action rather than a separate page.

## Navigation

The desktop navigation will prioritize:

1. Experience
2. Projects
3. Open Source
4. Community
5. Publications
6. Blogs
7. About

The site name or logo will link to Home. Education will be reachable from About and the homepage to keep the main navigation focused. A compact Contact action will remain visible in the header. Mobile navigation will expose all sections in a single accessible menu.

## Homepage Structure

1. **Hero**: Name, role, short positioning statement, current focus, and primary links.
2. **Experience**: Current or most relevant roles and a link to the complete experience page.
3. **Featured Projects**: Selected projects from the unified project collection.
4. **Open Source**: GitHub activity bar, contribution summary, and featured contributions.
5. **Publications**: Selected research and direct links to papers or publication pages.
6. **Community & Speaking**: Selected community work and sessions from one collection.
7. **Blogs**: Recent or featured posts.
8. **Education**: Concise academic background.
9. **About**: Short personal introduction with a link to the full page.
10. **Contact**: Email and social links.

Every homepage summary will link to the relevant archive or detail page.

## Routes

```text
/
├── experience/
├── projects/
│   └── [slug]/
├── open-source/
│   └── [slug]/
├── community/
│   └── [slug]/
├── publications/
│   └── [slug]/
├── blogs/
│   └── [slug]/
├── education/
├── about/
└── #contact
```

Projects and Community & Speaking will each use one archive and one content schema. Filters may be introduced later based on tags, but entries will not be classified into fixed subtypes.

## Technical Direction

Use **Astro with TypeScript**.

Astro is suitable because it provides:

- Static output compatible with GitHub Pages.
- First-class Markdown and MDX support.
- Content collections with validated frontmatter.
- Minimal client-side JavaScript by default.
- Built-in image optimization.
- Strong performance and SEO foundations.
- Support for page transitions and isolated interactive components.

Use custom CSS for the visual system. Add client-side JavaScript only for interactions that cannot be handled with HTML and CSS. Avoid a large animation or component dependency unless the final interactions require it.

## Content Architecture

```text
src/content/
├── experience/
├── projects/
├── open-source/
├── community/
├── publications/
├── blogs/
├── education/
└── pages/
    ├── home.md
    └── about.md
```

Plain Markdown will be the default authoring format. MDX will be supported for entries that need interactive demonstrations, embeds, or custom layouts.

### Common Frontmatter

```yaml
---
title: Example title
summary: Short description used on cards and in metadata
date: 2026-08-31
featured: true
draft: false
tags:
  - Astro
  - Open Source
cover: ./cover.webp
---
```

### Collection Metadata

| Collection | Additional fields |
| --- | --- |
| Experience | Organization, role, start date, end date, location, organization URL |
| Projects | Repository, live demo, stack, role, status |
| Open Source | Organization, repository, contribution URL, contribution summary, impact |
| Community & Speaking | Event or organization, date, location, related links, slides, recording |
| Publications | Authors, venue, DOI, paper URL, publication date, citation |
| Blogs | Description, canonical URL, publication date, cover image |
| Education | Institution, degree, specialization, start date, end date, location |

Project entries will not have a project-category or project-type field. Community entries will not have a fixed community, talk, workshop, or mentoring type field. Tags can describe technologies and topics without changing the unified presentation.

## GitHub Activity Bar

The Open Source section will include a GitHub-style contribution activity bar or calendar showing recent public activity.

The implementation should:

- Display approximately the last 52 weeks of contribution activity.
- Match the portfolio's visual system instead of embedding GitHub's full profile interface.
- Include accessible text for activity levels.
- Link to the GitHub profile.
- Provide a graceful fallback if contribution data cannot be loaded.
- Avoid exposing a GitHub access token in browser code.

Because GitHub Pages serves static files, a scheduled GitHub Actions workflow will refresh contribution data and rebuild the site daily. Pushes to `main` will continue to deploy immediately. This provides current activity without relying on a public client-side token or an unmaintained third-party widget.

If GitHub's available API permissions do not provide the required public contribution data during implementation, the fallback will be a lightweight server-generated contribution image from a maintained service. The rest of the Open Source content will remain fully static and Markdown-driven.

## Visual Direction

Use interaction principles associated with polished editorial product sites without copying Apple branding or page layouts:

- Strong typography and generous whitespace.
- Restrained neutral colors with one personal accent color.
- Large editorial sections for key work.
- Sticky translucent navigation.
- Subtle card depth, hover feedback, and link transitions.
- Scroll-triggered content reveals.
- Smooth page transitions.
- Responsive layouts for mobile and desktop.
- Full support for `prefers-reduced-motion`.
- Clear keyboard focus states and accessible interactions.

Motion will support content hierarchy rather than distract from it. CSS transitions, Astro transitions, and small browser APIs will be preferred over a heavy animation library.

## GitHub Pages Deployment

Create a GitHub Actions workflow that runs on every push to `main`:

1. Check out the repository.
2. Install the configured Node.js version.
3. Install dependencies with `npm ci`.
4. Validate Astro, TypeScript, and content schemas.
5. Run automated checks and the production build.
6. Upload the generated static artifact.
7. Deploy the artifact to GitHub Pages.

Pull requests will run validation and build checks without deploying. A scheduled workflow will run daily to refresh the GitHub activity data and redeploy only when appropriate.

The deployment workflow will use restricted permissions, deployment concurrency, and the official GitHub Pages actions.

## Custom Domain

The production setup will include:

- Astro's `site` configuration using the final domain.
- A `CNAME` file when required by GitHub Pages.
- Repository Pages settings for the custom domain.
- DNS instructions for an apex domain or `www` subdomain.
- HTTPS enforcement after DNS verification.
- Canonical URLs based on the production domain.

The exact DNS records will be documented after the domain and preferred hostname are provided.

## SEO and Sharing

Include:

- Per-page titles and descriptions.
- Canonical URLs.
- Open Graph and social preview metadata.
- Generated sitemap and `robots.txt`.
- RSS feed for Blogs.
- Structured data for the portfolio owner, blog posts, and publications.
- Publication metadata suitable for academic and search-engine discovery.
- Meaningful image alternative text and semantic headings.

## Quality Requirements

Before deployment, verify:

- Responsive behavior on common mobile and desktop sizes.
- Keyboard navigation and visible focus states.
- Correct semantic landmarks and heading order.
- Reduced-motion accessibility.
- Optimized responsive images.
- No broken internal links.
- Correct draft and featured-content handling.
- Successful clean production build.
- Strong Lighthouse performance, accessibility, SEO, and best-practice results.
- Correct custom-domain and GitHub Pages paths.
- Graceful GitHub activity-bar loading and failure states.

## Implementation Phases

1. Scaffold Astro, TypeScript, formatting, and validation.
2. Define content collections and Markdown or MDX templates.
3. Build the visual system, global layout, navigation, and responsive behavior.
4. Build Experience first, followed by the unified Projects collection.
5. Build Open Source content and the GitHub activity bar.
6. Build the unified Community & Speaking collection.
7. Build Publications, Blogs, Education, About, and Contact.
8. Compose the homepage summaries and featured-content logic.
9. Add transitions, scroll interactions, and accessibility fallbacks.
10. Add SEO, structured data, sitemap, RSS, and social metadata.
11. Add GitHub Actions deployment, scheduled activity refresh, and custom-domain configuration.
12. Add initial content or clearly marked example entries.
13. Run build, responsive, accessibility, link, and deployment verification.

## Inputs Needed Before Implementation

- Full name and preferred professional title.
- Short and long biography.
- Domain and preferred hostname.
- GitHub username.
- Email and social profile links.
- Preferred accent color or visual references.
- Profile image and optional resume link.
- Initial Experience, Projects, Open Source, Community, Publications, Blogs, and Education content.
