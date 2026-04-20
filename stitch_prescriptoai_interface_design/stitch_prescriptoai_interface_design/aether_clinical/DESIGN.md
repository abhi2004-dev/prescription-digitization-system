# Design System Document: Luminous Intelligence

## 1. Overview & Creative North Star

**Creative North Star: The Ethereal Clinic**
This design system moves away from the sterile, rigid grids of traditional medical software and toward a "Luminous Intelligence" aesthetic. We are building a digital concierge that feels both hyper-advanced and deeply human. To achieve this, the system rejects the "template" look in favor of high-end editorial layouts characterized by **intentional asymmetry, overlapping translucent layers, and breathing room.** 

The experience should feel like looking through sheets of polished glass in a sunlit, high-tech laboratory. We prioritize tonal depth over structural lines, ensuring the UI feels "grown" and "intelligent" rather than "assembled."

---

## 2. Colors

Our palette uses a sophisticated foundation of clinical whites and tech-forward blues, punctuated by "neon" accents that guide the user’s eye through complex medical data.

*   **Primary Foundation:** Use `surface` (#f6fafe) as the canvas. Use `primary` (#00677e) for core actions, but lean into `primary_container` (#00d4ff) for that "electric" futuristic feel.
*   **The "No-Line" Rule:** Under no circumstances should 1px solid borders be used to section content. Traditional "boxes" are forbidden. Boundaries must be defined solely through background color shifts. For example, a `surface-container-low` (#f0f4f8) section should sit directly on a `surface` (#f6fafe) background to create a soft, edge-less transition.
*   **Surface Hierarchy & Nesting:** Treat the mobile screen as a 3D space. 
    *   **Level 0:** `surface` (The base background).
    *   **Level 1:** `surface-container-low` (Secondary content areas).
    *   **Level 2:** `surface-container-lowest` (#ffffff) (Floating cards/Interactive elements).
*   **The "Glass & Gradient" Rule:** Main CTAs and hero sections must use a gradient transition from `primary` (#00677e) to `primary_container` (#00d4ff). Floating elements should utilize `surface_container_lowest` at 70% opacity with a `backdrop-blur` of 20px to create a premium glassmorphism effect.
*   **Signature Textures:** Apply a subtle radial gradient of `secondary_container` (#68fadd) at 5% opacity in the top-right corner of screens to simulate a soft "neon glow" from an off-screen light source.

---

## 3. Typography

The typography strategy pairs the technical precision of **Space Grotesk** with the approachable clarity of **Manrope**.

*   **Display & Headlines (Space Grotesk):** These are our "Intelligence" markers. Use `display-lg` and `headline-md` for data points and primary greetings. The wider tracking and geometric forms suggest a futuristic, AI-driven personality. Use `on_surface` (#171c1f) for maximum authority.
*   **Body & Titles (Manrope):** This is our "Human" voice. Use `title-md` for navigation and `body-md` for medical descriptions. The warmth of Manrope balances the coldness of the tech aesthetic.
*   **Hierarchy as Navigation:** Contrast is key. Pair a large `display-md` metric (e.g., "98 BPM") with a tiny, all-caps `label-sm` ("HEART RATE") to create an editorial look that guides the eye without needing heavy icons.

---

## 4. Elevation & Depth

We avoid the "flat" look of Material Design 2.0. Depth in this design system is achieved through **Tonal Layering** and **Ambient Light.**

*   **The Layering Principle:** Instead of shadows, use color logic. Place a `surface_container_lowest` (#ffffff) card on top of a `surface_container_low` (#f0f4f8) area. The subtle shift in hex value creates enough "lift" for a premium feel without visual clutter.
*   **Ambient Shadows:** If a card must float (e.g., a critical AI notification), use a shadow with a 32px blur, 0px offset, and 6% opacity of the `on_surface` color. This mimics natural light dispersion rather than a harsh artificial drop shadow.
*   **The "Ghost Border" Fallback:** If a container requires definition against an identical background for accessibility, use the `outline_variant` (#bbc9cf) at **15% opacity**. It should be barely felt, not seen.
*   **Glassmorphism Depth:** When an element uses backdrop-blur, it effectively "belongs" to the layer beneath it. Use this for navigation bars and overlays to maintain a sense of context and continuity.

---

## 5. Components

### Buttons
*   **Primary:** A gradient from `primary` to `primary_container`. Roundedness: `full`. Use a subtle inner-glow (top edge white at 20%) to give it a 3D glass bead effect.
*   **Secondary:** `surface_container_highest` background with `on_surface_variant` text. No border.
*   **Tertiary:** Transparent background, `primary` text, `label-md` weight.

### Input Fields
*   **Structure:** Never use "outlined" or "filled" boxes. Use a `surface_container_low` background with a `full` roundedness. 
*   **States:** On focus, the background should shift to `surface_container_lowest` and gain a 1px "Ghost Border" of `primary` at 30% opacity.

### Cards & Lists
*   **Lists:** Forbid the use of divider lines. Separate list items using `12px` of vertical white space or by alternating background colors between `surface` and `surface_container_low`.
*   **AI Insight Cards:** These should use a subtle gradient border—not a solid line, but a `2px` stroke that fades from `secondary` (#006b5c) to transparent, suggesting the AI is "scanning" the content.

### Chips
*   **Action Chips:** Use `secondary_fixed` (#68fadd) for a neon "active" state. Roundedness: `md`.

### Specialized: The "Pulse" Component
*   For active AI processing, use a glowing dot using `primary_fixed_dim` (#3cd7ff) with a CSS animation that scales a transparent circle outward, mimicking a heartbeat or a sonar ping.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use asymmetrical margins. For example, a header might be indented 32px while the body text is 24px, creating an editorial "path."
*   **Do** use overlapping elements. A glass card can partially cover a background gradient or a large display heading.
*   **Do** prioritize white space. If a screen feels "full," remove a container and use a typography shift instead.

### Don't:
*   **Don't** use 100% black (#000000) or high-contrast borders. It breaks the "Luminous" illusion.
*   **Don't** use standard "drop shadows." If it looks like a 2014 app, blur it more and lower the opacity.
*   **Don't** crowd the edges. On mobile, maintain at least a 20px "safe zone" from the screen edge unless an element is intentionally bleeding off the side for effect.
*   **Don't** use generic icons. Every icon should have a consistent stroke weight (1.5px) matching the `outline` token.