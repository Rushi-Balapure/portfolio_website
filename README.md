# Markdown Portfolio

A minimal, editorial portfolio built with Astro, TypeScript, Markdown, and optional MDX. Content covers experience, projects, open source, community and speaking, publications, blogs, education, and about information.

The full product and implementation context is recorded in [`PORTFOLIO_PLAN.md`](./PORTFOLIO_PLAN.md).

## Requirements

- Node.js 22.12 or newer (`.nvmrc` is included)
- npm 9.6 or newer

## Local Development

```bash
nvm use
npm install
npm run dev
```

Run the production checks with:

```bash
npm run build
```

## Add Content

Content lives under `src/content/`. Copy the placeholder in the relevant collection, rename it to the desired URL slug, replace its frontmatter and body, and set `draft: false` when it is ready to publish.

Projects use one unified schema with no project-type distinction. Community and speaking entries also use one unified schema. Plain Markdown is supported everywhere, and files can use `.mdx` when an entry needs a component or interactive embed.

Edit `src/content/pages/home.md` to set the shared identity and contact fields:

```yaml
name: Your Name
role: Your Professional Focus
email: hello@example.com
githubUrl: https://github.com/your-name
linkedinUrl: https://www.linkedin.com/in/your-name
githubUsername: your-name
```

## GitHub Activity

`npm run fetch:github` fetches the public contribution calendar at build time. It requires `GITHUB_USERNAME` and `GITHUB_TOKEN`; neither token nor API data is requested by the visitor's browser.

GitHub Actions defaults to the repository owner for activity and to `https://rushibalapure.site` for production URLs. These optional repository variables under **Settings → Secrets and variables → Actions → Variables** can override those defaults:

- `GITHUB_USERNAME`: GitHub account shown in the activity bar.
- `SITE_URL`: Complete production origin, such as `https://portfolio.example.com`.

The deployment workflow receives a short-lived built-in `GITHUB_TOKEN`. It rebuilds on every push to `main` and once daily to refresh contribution activity.

## GitHub Pages And Domain

1. Open **Settings → Pages** in the GitHub repository.
2. Select **GitHub Actions** as the source.
3. Add the custom domain in the Pages settings.
4. Add the domain provider's `A`/`AAAA` records for an apex domain or `CNAME` for a subdomain.
5. Set the `SITE_URL` Actions variable to the same HTTPS origin.
6. Enable **Enforce HTTPS** after DNS verification succeeds.

Add `public/CNAME` containing only the final hostname after the domain is confirmed. It is intentionally not populated with a placeholder because that would break Pages domain configuration.

## Deployment

- Pull requests run `.github/workflows/check.yml`.
- Pushes to `main`, manual runs, and the daily schedule run `.github/workflows/deploy.yml`.
- The output in `dist/` is uploaded through the official GitHub Pages actions.
