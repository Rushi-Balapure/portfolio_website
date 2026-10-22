# Component design references

The redesign uses native Astro, CSS, and small TypeScript enhancements. No React runtime, component registry, or animation package was added. These are original implementations of the selected visual and interaction patterns, rather than copied library source.

| Reference | Portfolio use |
| --- | --- |
| [Aceternity: Macbook Scroll](https://ui.aceternity.com/components/macbook-scroll) | Laptop frame and gentle scroll-driven lid reveal. The screen introduces Rushi through his portrait, role, and interests. |
| [Magic UI: Terminal](https://magicui.design/docs/components/terminal) | Terminal-style illustration for the Arise project card. |
| [React Bits: Spotlight Card](https://reactbits.dev/components/spotlight-card) | Soft pointer-following lighting on linked content cards. |
| [shadcn/ui: Tabs](https://ui.shadcn.com/docs/components/tabs) | Compact technology categories with arrow-key, Home, and End navigation. |

[Rare UI](https://www.rareui.com/) was also reviewed. No Rare UI source or components are included.

All content and links render on the server. Without JavaScript, technology groups remain visible and links continue to work. Reduced-motion preferences disable the laptop animation, animated entrances, and pointer tracking. The laptop content is a personal introduction, not a running application or a project demo.
