# Design System: Yokogawa Weekly Report Web Application
## "Precision Through Stability"

### 1. Vision & Core Philosophy
The **Weekly Report** design system is engineered to bridge the gap between heavy industrial reliability and modern digital efficiency. It moves away from the "utility-only" look of legacy industrial software towards a "Precision Analytics" aesthetic.

*   **Reliability:** Visual weight and stable structures that inspire trust in mission-critical environments.
*   **Clarity:** A "data-first" approach where information hierarchy is the primary driver of the layout.
*   **Precision:** Every pixel, margin, and corner radius is intentional, reflecting the high-spec nature of Yokogawa's engineering.

---

### 2. Brand Identity & Color Palette
The palette is derived directly from Yokogawa's corporate identity, balanced for prolonged screen use and high legibility.

*   **Primary: Yokogawa Blue (#0054A6)**
    *   *Usage:* Global navigation, primary buttons, brand headers, and active states. 
    *   *Rationale:* Symbolizes stability, intelligence, and the established heritage of the brand.
*   **Accent: Yokogawa Yellow (#FFD100)**
    *   *Usage:* Critical status indicators, "spark" icons for AI features, and high-visibility alerts.
    *   *Rationale:* Represents innovation and energy. Used sparingly to avoid visual fatigue.
*   **Neutral Foundation:**
    *   *Surface High:* #FFFFFF (Main content areas)
    *   *Surface Low:* #F8FAFC (App background / Shell)
    *   *Border:* #E2E8F0 (Subtle containment)
    *   *Text Primary:* #0F172A (Deep Slate for maximum contrast)

---

### 3. Typography
We utilize **Inter**, a variable typeface designed for highly legible UI.

*   **Headlines:** Semi-bold to Bold, tight tracking (-0.02em). Used to anchor sections.
*   **Body:** Regular, 14px-16px. Optimized for density without sacrificing readability.
*   **Monospace (Optional):** Used for technical IDs (e.g., WBS codes, system logs) to denote "Raw Data."

---

### 4. Component Architecture
Components are designed with "Industrial Density" — enough information to be useful at a glance, but with enough whitespace to remain approachable.

#### 4.1. Navigation Shell
*   **Sidebar:** Fixed, high-contrast. Uses deep brand colors or clean whites to separate "System Controls" from "Task Content."
*   **Top Bar:** Minimalist. Contains breadcrumbs, global search, and system status indicators.

#### 4.2. Data & Status Cards
*   **Structure:** Rounding is kept at a professional 4px (ROUND_FOUR).
*   **Status Badges:** Color-coded (Success, Alert, Draft) with clear text labels to ensure accessibility (WCAG 2.1 compliance).

#### 4.3. Kanban & Board Logic
*   **Column Headers:** Clear count indicators and descriptive titles.
*   **Task Cards:** Multi-layered information (Task ID, Priority Badge, User Avatar, and Deadline) with consistent padding.

---

### 5. Interaction Patterns
*   **Subtle Hover:** Interactive elements use a gentle tonal shift (e.g., bg-slate-50) rather than heavy shadows.
*   **Feedback Loops:** Buttons transition smoothly but quickly (150ms-200ms) to provide a responsive "engineered" feel.
*   **Empty States:** Clear, icon-driven empty states to guide users who are new to a module.

---

### 6. Design for Maintenance
This system is built using a modular utility-first approach (Tailwind CSS logic). It ensures that as the Yokogawa application grows from Project Management to Analytics or Reporting, the visual language remains unbroken.
