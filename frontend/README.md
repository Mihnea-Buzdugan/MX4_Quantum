# Quantum Railways

Quantum Railways is a responsive railway construction-planning frontend. The Quantum Algorithm workspace demonstrates budget-aware heuristic route selection, while the Classic Algorithm workspace incrementally evaluates route combinations to find the highest-value plan within budget. Both workspaces update the Romania network map and construction trackers from read-only algorithm output.

## Development

```sh
npm install
npm run dev
```

## Checks

```sh
npm run build
npm run lint
```

The construction budget, eight cities, twelve proposed connections, destination goals, route values, and model evaluation data are hardcoded in `src/data/routes.ts`. Construction cost refers only to building railway infrastructure. The quantum workspace is a frontend heuristic simulation and does not connect to quantum hardware.
