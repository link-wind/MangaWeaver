## Context

See proposal.md. The current Electron app uses React components and a shared `workbench.css`; existing component structure and `desktop/DESIGN.md` are the implementation baseline. The detailed visual targets are in `docs/WORKBENCH_VISUAL_DESIGN_PLAN.md`.

## Goals / Non-Goals

**Goals:** Apply one consistent visual hierarchy across the existing home, library, canvas, and conversation surfaces while preserving current user operations and stored state.

**Non-Goals:** Replace the component stack, introduce another design system dependency, change engine behavior, or redesign the application information architecture.

## Decisions

- Tune existing React components and shared CSS. Keep the current Electron, React Flow, and Lucide stack; adding a component library would add migration work without improving this focused visual pass.
- Use shared CSS variables for the established white, gray, charcoal, and restrained purple palette. Keep typography on the platform system stack for Chinese rendering and offline use.
- Implement the homepage hierarchy and compact attachment first, then library cards, then canvas and conversation refinements. This follows the user's primary entry flow and makes each stage visually reviewable.
- Preserve existing content, task, and session data. Visual grouping and expanded states should use current component state and real artifacts; do not invent progress or agent activity.
- Keep dividers as one-pixel edge-aligned borders with transparent hit areas for resizing. Do not apply shadows to separators or fixed panels.

## Risks / Trade-offs

- [Tighter layout may clip long Chinese text or filenames] → Check narrow windows, long names, and expanded conversation content in the running desktop app.
- [Shared CSS selectors may affect unrelated screens] → Scope new rules to existing page/component classes and inspect home, library, and canvas after each pass.
- [Subtle colors can reduce readability] → Preserve explicit text contrast and visible keyboard focus; tune actual rendered colors rather than relying on token names.

## Migration Plan

No data migration. Apply the existing CSS and component updates in place. If a visual regression appears, revert only the affected scoped styles or component markup.

