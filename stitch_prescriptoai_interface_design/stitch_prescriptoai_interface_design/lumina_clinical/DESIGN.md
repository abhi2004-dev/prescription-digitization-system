# Design System Specification: The Clinical Luminary

## 1. Overview & Creative North Star
This design system is anchored by a Creative North Star we call **"The Clinical Luminary."** 

In high-end healthcare, intelligence is not just about data; it is about clarity and the "glow" of insight. We are moving away from the rigid, boxed-in layouts of legacy medical software. Instead, we embrace a **High-End Editorial** aesthetic that utilizes intentional asymmetry, expansive negative space, and a sophisticated interplay of light and depth. 

The goal is to make the user feel like they are interacting with a living, breathing intelligence. We achieve this through "The Pulse"—our deep purple accent—and a "Light-Wash" architecture that relies on tonal shifts rather than structural lines to define space.

---

## 2. Colors & Chromatic Intent
Our palette is a study in clinical precision and futuristic depth. The foundation is a cool, sterile light gray, punctuated by a rich, intelligent purple.

### The Foundation
*   **Surface (Base):** `#f8f9fc` — The canvas.
*   **Primary:** `#4800b2` — The soul of the system.
*   **Primary Container:** `#6200ee` — Use this for interactive "glow" states and high-priority CTAs.

### The "No-Line" Rule
Explicitly prohibit the use of 1px solid borders to section content. Boundaries must be defined solely through background color shifts.
*   **Sectioning:** Place a `surface-container-low` (`#f2f3f6`) section against a `surface` (`#f8f9fc`) background to create a "silent" division.
*   **Nesting:** For internal modules, use `surface-container` (`#edeef1`) to create a sense of focused containment without closing the layout.

### Signature Textures & Glass
To evoke a premium, futuristic feel, use **Glassmorphism** for floating elements (modals, popovers). 
*   **Token:** Use `surface_container_lowest` (`#ffffff`) at 70% opacity with a `20px` backdrop-blur. 
*   **The Signature Gradient:** For hero elements or primary CTAs, use a linear gradient: `primary` (`#4800b2`) to `primary_container` (`#6200ee`) at a 135-degree angle. This provides a visual "soul" that flat colors cannot achieve.

---

## 3. Typography
We utilize a dual-typeface system to balance technical authority with human readability.

*   **Display & Headlines (Space Grotesk):** This is our "Intelligent" face. Its geometric, slightly eccentric forms suggest a futuristic, data-driven backbone. 
    *   *Usage:* Use `display-lg` (3.5rem) with tight letter-spacing (-0.02em) for hero headlines to create an editorial, high-fashion medical impact.
*   **Body & Titles (Manrope):** This is our "Human" face. Manrope offers exceptional legibility at small scales, essential for clinical data.
    *   *Usage:* `body-md` (0.875rem) is the workhorse for patient data and reports. 

**Typographic Hierarchy Note:** Always favor extreme scale contrast. A very large `display-md` headline paired with a very small, all-caps `label-md` creates an "Editorial Modern" look that feels premium and intentional.

---

## 4. Elevation & Depth
In this system, depth is a result of **Tonal Layering**, not heavy dropshadows.

### The Layering Principle
Think of the UI as stacked sheets of frosted glass.
1.  **Level 0 (Base):** `surface` (`#f8f9fc`)
2.  **Level 1 (Cards):** `surface-container-lowest` (`#ffffff`) — Provides a soft, natural lift.
3.  **Level 2 (Active States):** `surface-container-high` (`#e7e8eb`)

### Ambient Shadows
Shadows must be "Ambient," mimicking a large, soft light source. 
*   **Standard Lift:** `0px 12px 32px rgba(25, 28, 30, 0.04)`. 
*   **Shadow Tinting:** Never use pure black for shadows. Use a tinted version of `on-surface` (`#191c1e`) to keep the "Light-Wash" aesthetic clean.

### The "Ghost Border" Fallback
If a container requires a border for accessibility (e.g., input fields), use a **Ghost Border**: `outline-variant` (`#cbc3d9`) at 20% opacity. It should be felt, not seen.

---

## 5. Components

### Buttons
*   **Primary:** A gradient fill (`primary` to `primary_container`). Border-radius: `full` (9999px) for a "pill" look that feels approachable yet high-tech.
*   **Secondary:** A Ghost Border (`outline-variant` at 30%) with `on-primary-fixed-variant` text.
*   **Interaction:** On hover, primary buttons should emit a soft glow using a spread shadow of the `primary` color at 20% opacity.

### Cards & Lists
*   **Forbid Dividers:** Do not use horizontal lines to separate list items. Use vertical white space (16px - 24px) or a subtle hover state shift to `surface-container-low`.
*   **Card Styling:** Use `lg` (0.5rem) or `xl` (0.75rem) roundedness. No borders. Use `surface-container-lowest` for the card body on a `surface` background.

### Input Fields
*   **Style:** Minimalist. Only a bottom-weighted "Ghost Border." 
*   **Focus State:** The border transitions to `primary` (`#4800b2`) and the label (using `label-sm`) floats above with a slight purple glow effect.

### Chips
*   **Action Chips:** Use `secondary-fixed` (`#e8ddff`) backgrounds with `on-secondary-fixed` (`#22005d`) text. This creates a "soft-tech" look that distinguishes metadata from primary actions.

### Clinical Data Visualization (Custom Component)
*   **The "Pulse" Line:** Use `primary_container` for data trends. Apply a 4px blur glow behind the line to simulate a high-tech monitor.

---

## 6. Do’s and Don’ts

### Do:
*   **Embrace Asymmetry:** Align text to the left but place supporting imagery or data visualizations offset to the right to break the "grid" feel.
*   **Use Generous White Space:** If you think there is enough space, add 20% more. Premium design requires "room to breathe."
*   **Leverage Tonal Shifts:** Define the sidebar from the main content using only a shift from `surface` to `surface-container-lowest`.

### Don't:
*   **Don't use 100% Opaque Borders:** This immediately kills the "futuristic" aesthetic and makes the UI look like a standard template.
*   **Don't use pure black text:** Always use `on-surface` (`#191c1e`) to maintain the sophisticated, softened contrast of the system.
*   **Don't crowd the data:** Clinical information is dense by nature. Use the `body-lg` and `body-sm` hierarchy to create "scannable islands" of information rather than a wall of text.