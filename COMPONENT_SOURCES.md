# Component design references

The redesign uses native Astro, CSS, and small TypeScript enhancements. No React runtime, component registry, or animation package was added. These are original implementations of the selected visual and interaction patterns, rather than copied library source.

| Reference | Portfolio use |
| --- | --- |
| [Magic UI: Terminal](https://magicui.design/docs/components/terminal) | Terminal-style illustration for the Arise project card. |
| [React Bits: Spotlight Card](https://reactbits.dev/components/spotlight-card) | Soft pointer-following lighting on linked content cards. |
| [shadcn/ui: Tabs](https://ui.shadcn.com/docs/components/tabs) | Compact technology categories with arrow-key, Home, and End navigation. |

[Rare UI](https://www.rareui.com/) was also reviewed. No Rare UI source or components are included.

All content and links render on the server. Without JavaScript, technology groups remain visible and links continue to work. Reduced-motion preferences disable animated entrances and pointer tracking. The homepage introduces Rushi through his name, biography, and portrait.

Page navigation uses [Astro's ClientRouter](https://docs.astro.build/en/guides/view-transitions/) with a 240 ms content crossfade and an animation fallback for browsers without native view transitions. Controls reinitialize after navigation. Technology panels share a stable grid area and crossfade without shifting subsequent sections. Menu animations can reverse during opening or closing; theme changes crossfade where the browser supports the View Transition API. Reduced-motion preferences disable these animations.
