import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const outputPath = resolve('src/data/github-contributions.json');
const username = process.env.GITHUB_USERNAME;
const token = process.env.GITHUB_TOKEN;

if (!username || !token) {
  console.log('Skipping GitHub activity refresh: GITHUB_USERNAME or GITHUB_TOKEN is not set.');
  process.exit(0);
}

const query = `
  query ContributionCalendar($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              date
              weekday
            }
          }
        }
      }
    }
  }
`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'markdown-portfolio-build',
  },
  body: JSON.stringify({ query, variables: { login: username } }),
});

if (!response.ok) {
  throw new Error(`GitHub API request failed with ${response.status}.`);
}

const payload = await response.json();
if (payload.errors?.length || !payload.data?.user) {
  throw new Error(payload.errors?.[0]?.message ?? `GitHub user "${username}" was not found.`);
}

const calendar = payload.data.user.contributionsCollection.contributionCalendar;
const level = (count) => {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
};

const data = {
  username,
  totalContributions: calendar.totalContributions,
  updatedAt: new Date().toISOString(),
  weeks: calendar.weeks.slice(-52).map((week) => ({
    days: week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
      level: level(day.contributionCount),
    })),
  })),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Updated GitHub activity for ${username}: ${data.totalContributions} contributions.`);
