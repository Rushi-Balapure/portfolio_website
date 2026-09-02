import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const contentLoader = (base: string) =>
  glob({ base, pattern: "**/*.{md,mdx}" });

const sharedFields = {
  title: z.string().min(1),
  summary: z.string().min(1),
  date: z.coerce.date(),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
  tags: z.array(z.string().min(1)).default([]),
};

const experience = defineCollection({
  loader: contentLoader("./src/content/experience"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        cover: image().optional(),
        organization: z.string().min(1),
        role: z.string().min(1),
        highlights: z.array(z.string().min(1)).default([]),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
        location: z.string().min(1).optional(),
        organizationUrl: z.url().optional(),
      })
      .strict(),
});

const projects = defineCollection({
  loader: contentLoader("./src/content/projects"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        cover: image().optional(),
        repositoryUrl: z.url().optional(),
        demoUrl: z.url().optional(),
        stack: z.array(z.string().min(1)).optional(),
        role: z.string().min(1).optional(),
        priority: z.number().int().default(0),
        status: z
          .enum(["planned", "in-progress", "completed", "maintained", "archived"])
          .optional(),
      })
      .strict(),
});

const openSource = defineCollection({
  loader: contentLoader("./src/content/open-source"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        cover: image().optional(),
        organization: z.string().min(1).optional(),
        repositoryUrl: z.url().optional(),
        contributionUrl: z.url().optional(),
        packageUrl: z.url().optional(),
        contributionSummary: z.string().min(1).optional(),
        impact: z.string().min(1).optional(),
      })
      .strict(),
});

const community = defineCollection({
  loader: contentLoader("./src/content/community"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        cover: image().optional(),
        eventOrOrganization: z.string().min(1).optional(),
        location: z.string().min(1).optional(),
        relatedLinks: z
          .array(
            z
              .object({
                label: z.string().min(1),
                url: z.url(),
              })
              .strict(),
          )
          .optional(),
        slidesUrl: z.url().optional(),
        recordingUrl: z.url().optional(),
      })
      .strict(),
});

const publications = defineCollection({
  loader: contentLoader("./src/content/publications"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        cover: image().optional(),
        authors: z.array(z.string().min(1)).optional(),
        venue: z.string().min(1).optional(),
        doi: z.string().min(1).optional(),
        paperUrl: z.url().optional(),
        citation: z.string().min(1).optional(),
      })
      .strict(),
});

const blogs = defineCollection({
  loader: contentLoader("./src/content/blogs"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        description: z.string().min(1).optional(),
        canonicalUrl: z.url().optional(),
        cover: image().optional(),
      })
      .strict(),
});

const education = defineCollection({
  loader: contentLoader("./src/content/education"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        cover: image().optional(),
        institution: z.string().min(1),
        university: z.string().min(1).optional(),
        degree: z.string().min(1),
        specialization: z.string().min(1).optional(),
        cgpa: z.string().min(1).optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
        location: z.string().min(1).optional(),
      })
      .strict(),
});

const pages = defineCollection({
  loader: contentLoader("./src/content/pages"),
  schema: ({ image }) =>
    z
      .object({
        ...sharedFields,
        cover: image().optional(),
         seoTitle: z.string().min(1).optional(),
         canonicalUrl: z.url().optional(),
         name: z.string().min(1).optional(),
         role: z.string().min(1).optional(),
         eyebrow: z.string().min(1).optional(),
         location: z.string().min(1).optional(),
         availability: z.string().min(1).optional(),
         email: z.email().optional(),
         githubUrl: z.url().optional(),
         linkedinUrl: z.url().optional(),
         xUrl: z.url().optional(),
         githubUsername: z.string().min(1).optional(),
      })
      .strict(),
});

export const collections = {
  experience,
  projects,
  openSource,
  community,
  publications,
  blogs,
  education,
  pages,
};
