# Design System

## Product Direction

`cqie课表` is a quiet campus utility. It prioritizes the next useful class, keeps official timetable data legible, and never compresses conflicting courses until they obscure one another.

## Visual Language

- White surfaces, graphite text, cobalt navigation, and restrained per-course colors.
- Compact operational typography using the platform UI font stack.
- Corners stay at 8px for controls and course rows; larger legacy desktop containers may retain their existing radius.
- Course colors provide wayfinding, while red is reserved for explicit time conflicts and errors.
- Icons use the same outline SVG language throughout. Interactive icon controls always have an accessible name.

## Responsive Behavior

- At widths above 820px, the week remains a seven-column grid.
- Two simultaneous courses use side-by-side lanes. Three or more use one explicit conflict group that opens a complete list.
- At 820px and below, the grid becomes a seven-day selector followed by a full-width agenda for the selected day.
- Every mobile course remains an independent row. Conflicts are labeled, never overlaid.
- Mobile interactive targets are at least 44 by 44 CSS pixels.

## Interaction

- Tabs and day selectors expose selected state and support arrow-key movement.
- Course rows, online courses, today rows, and conflict groups are native buttons.
- Dialogs move focus inside, trap Tab navigation, close with Escape, restore focus, and make the background inert.
- Motion is minimal and respects `prefers-reduced-motion`.

## Trust Boundary

School credentials are entered only on official CQIE pages. The client reads the timetable directly from official APIs and stores tokens and cached schedule data only on the user's device. The Safari OAuth callback must be verified before public deployment.
