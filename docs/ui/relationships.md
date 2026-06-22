# Relationship Graph

The Play interface exposes a Relationships tab that renders sparse character relationship labels as a directed Cytoscape graph. It shares the same Cytoscape vendor stack and tab activation pattern used by the Region Map and World Map.

## Entry Points

- `views/index.njk` defines the Relationships tab button, `#tab-relationships` panel, reload button, `#relationshipGraphContainer`, script include, and tab activation hook.
- `public/js/relationship-graph.js` owns relationship graph fetching, graph element construction, Cytoscape styling, layout, loading, empty, and error states.
- `public/css/main.scss` styles the relationship graph panel by extending the shared map tab container rules. Compile to `public/css/main.css` after edits.

## Data Source

- The client fetches `GET /api/players` with `cache: "no-store"`.
- Each serialized actor may include `relationships`, a sparse object keyed by target character id with labels of at most six words.
- `currentPlayer` from the response marks the current player node with a stronger border.

## Rendering Model

- Only visible actors that participate in at least one rendered relationship edge are displayed.
- Living actors with `hiddenFromPlayer: true` are omitted, and edges to or from those actors are omitted so the graph does not reveal hidden NPCs.
- Existing actors render as circular portrait nodes. Actors with `imageId` use `/api/images/:imageId/file`; actors without portraits use generated initials.
- Each `relationships` entry renders as one directed edge from the owning actor to the target id. There is no separate incoming/outgoing storage model; a reciprocal relationship is just a second directed edge stored on the other actor.
- Edges use curved `unbundled-bezier` styling. Every directed edge curves clockwise relative to its source-to-target direction, so reciprocal edges naturally land on opposite sides of the same pair.
- After layout, the renderer computes manual Cytoscape endpoints for every edge. Curve starts and ends are offset slightly toward the curve side, further separating reciprocal arrows.
- Relationship labels are separate non-interactive Cytoscape label nodes placed at the quadratic Bezier midpoint of the arc. Labels are horizontal, white with a black outline, have no text box, and use manual z-ordering so they render above both portraits and curves.
- If a relationship points to an id that is not present in `/api/players`, the graph renders a distinct missing-character node keyed by that target id. Each missing id gets its own red `?` portrait node instead of sharing one unknown node.

## Interactions

- Opening the Relationships tab calls `window.loadRelationshipGraph()`.
- Clicking the active Relationships tab or the Reload button fetches and lays out the graph again.
- Slash-command refresh payloads with `relationshipGraphRefreshRequested: true` also call `window.loadRelationshipGraph()`, so `/clear_relationships` can update an open graph after clearing saved edges.
- Empty relationship data renders an inline empty state. API, data-shape, or Cytoscape errors render an explicit error state in the graph container.
