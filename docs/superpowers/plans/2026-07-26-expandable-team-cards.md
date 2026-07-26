# Expandable Team Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add expandable team member cards to the /team page that smoothly expand to full width when clicked and close when clicking outside.

**Architecture:** Convert the team page to a client component with React state tracking the expanded card. Each card is clickable; on click it expands to full width via CSS grid, and a document-level click listener closes it when clicking outside. CSS transitions provide smooth animation.

**Tech Stack:** React (useState, useEffect), Next.js client components, Tailwind CSS transitions

---

### Task 1: Update Staff Data with Full Bios

**Files:**
- Modify: `app/team/page.tsx:1-27`

- [ ] **Step 1: Replace placeholder bios with full descriptions**

Update the `staff` array with the exact bios and corrected role titles:

```typescript
const staff = [
  {
    name: "Emily Song",
    role: "Founder, CEO & Co-President",
    bio: "Emily sets CurioLab's long-term vision, organizational strategy, and standards for program quality. She leads partnerships, chapter expansion, and the development of a sustainable model that supports both young learners and university fellows.",
  },
  {
    name: "Ana Izma",
    role: "COO & Co-President",
    bio: "Ana oversees CurioLab's day-to-day operations and ensures that its programs, teams, and university chapters run effectively. She translates organizational goals into clear systems, coordinated execution, and a consistent experience across the organization.",
  },
  {
    name: "Vinh-Khang Luu",
    role: "Chief Financial Officer",
    bio: "Vinh-Khang leads CurioLab's financial planning, budgeting, and resource management. He works to maintain responsible financial practices and ensure that the organization's growth remains sustainable and aligned with its mission.",
  },
  {
    name: "Esmerelda Qiang",
    role: "Chief Marketing Officer",
    bio: "Esmerelda leads CurioLab's brand, communications, and community outreach. She shapes how the organization shares its mission, engages families and partners, and builds awareness among students, universities, and supporters.",
  },
  {
    name: "Tienna Zeng",
    role: "Director of Mentor & Student Relations",
    bio: "Tienna oversees the experience and development of CurioLab's students and mentors. She supports onboarding, relationship-building, and ongoing communication to create a welcoming, dependable, and growth-oriented program community.",
  },
];
```

- [ ] **Step 2: Verify bios are complete**

Visually inspect that all 5 staff members have full bio text (3-4 sentences each), role titles match provided text, and no "Add bio." placeholders remain.

---

### Task 2: Convert to Client Component and Add State Management

**Files:**
- Modify: `app/team/page.tsx` (full file)

- [ ] **Step 1: Add 'use client' directive and imports**

Replace the entire page file with this structure (keeping staff array from Task 1):

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';

const staff = [
  // ... staff array from Task 1 ...
];

export default function TeamPage() {
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ... rest of component ...
}
```

- [ ] **Step 2: Add outside-click handler using useEffect**

Inside the `TeamPage` component, after the state declarations, add:

```typescript
useEffect(() => {
  function handleClickOutside(e: MouseEvent) {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setExpandedName(null);
    }
  }

  if (expandedName) {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }
}, [expandedName]);
```

- [ ] **Step 3: Verify imports are correct**

Check that `useState`, `useEffect`, and `useRef` are imported from 'react'.

---

### Task 3: Update Card Rendering with Click Handler and Conditional Styling

**Files:**
- Modify: `app/team/page.tsx:40-49` (the grid and card map)

- [ ] **Step 1: Replace the staff grid with expanded click logic**

Replace the grid section with:

```typescript
<div 
  ref={containerRef}
  className="grid md:grid-cols-3 gap-8 mb-20 auto-rows-max"
>
  {staff.map((s) => (
    <div
      key={s.name}
      onClick={() => setExpandedName(s.name)}
      className={`
        bg-white border border-black/10 rounded-xl p-6 cursor-pointer
        transition-all duration-300 ease-out
        ${expandedName === s.name ? 'md:col-span-3' : ''}
      `}
    >
      <div className="w-12 h-12 rounded-full bg-ivory mb-4" />
      <h3 className="font-bold text-lg">{s.name}</h3>
      <p className="label mb-3">{s.role}</p>
      <p className="text-sm text-muted">{s.bio}</p>
    </div>
  ))}
</div>
```

- [ ] **Step 2: Verify styling classes**

- `cursor-pointer` makes the card appear clickable
- `transition-all duration-300` animates smoothly
- `md:col-span-3` makes the expanded card take full width on medium screens and up
- `auto-rows-max` prevents the grid from stretching rows

---

### Task 4: Test the Interaction

**Files:**
- Test in browser at `http://localhost:3000/team`

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Navigate to /team page**

Open browser to `http://localhost:3000/team`

- [ ] **Step 3: Test click to expand**

Click on any team member card. Expected: Card smoothly expands to full width, other cards push to next row below.

- [ ] **Step 4: Test expand persistence**

While a card is expanded, click on another card. Expected: First card collapses, second card expands (only one expanded at a time).

- [ ] **Step 5: Test outside-click close**

Expand a card, then click anywhere outside the grid area (e.g., on the page background). Expected: Card smoothly collapses and grid returns to 3-column layout.

- [ ] **Step 6: Test on mobile**

Resize browser to mobile width (< 768px). Expected: Cards display in single column and expand logic still works (though col-span-3 won't affect single-column layout — that's fine, the full bio is still visible).

---

### Task 5: Commit the Changes

**Files:**
- Modified: `app/team/page.tsx`

- [ ] **Step 1: Stage the changes**

Run: `git add app/team/page.tsx`

- [ ] **Step 2: Commit with descriptive message**

```bash
git commit -m "feat(team): add expandable bios with smooth full-width expand animation

- Update team member bios with full descriptions
- Add interactive expand/collapse to team cards
- Expanded cards take full width and push others down
- Outside-click listener closes expanded cards
- Smooth CSS transition animation on expand/collapse"
```

- [ ] **Step 3: Verify commit**

Run: `git log --oneline -1`

Expected output shows your commit message at the top.
