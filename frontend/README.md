# Quantum Railways

Quantum Railways is a responsive railway construction-planning frontend. The Classic Algorithm workspace incrementally evaluates route combinations, and the Quantum Algorithm workspaces demonstrate budget-aware heuristic route selection in simulated and real-hardware modes. All workspaces update the Romania network map and construction trackers from the same route data.

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

The construction budget, eight cities, twelve proposed connections, destination goals, route values, and model evaluation data are hardcoded in `src/data/routes.ts`. Construction cost refers only to building railway infrastructure. Both quantum modes are frontend demonstrations; the real-hardware workspace does not connect to quantum hardware.

All algorithm workspaces share a speed selector. Realtime evaluates the plan in one UI update; x0.5 Speed animates route decisions with a shorter delay between steps. The time-taken metric reports algorithm processing time, while the header compares visual simulation duration with processing time.
