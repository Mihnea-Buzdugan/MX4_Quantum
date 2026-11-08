import { useState } from 'react'
import { ChevronDown, LocateFixed, Minus, Plus } from 'lucide-react'
import { cities, routes, type RailRoute } from '../data/routes'
import type { RailwayPlanEdge } from '../services/railwayPlanner'

type Props = {
  builtRouteIds: Array<string | number>
  configuredRouteIds?: string[]
  displayRoutes?: RailRoute[]
  routeStages?: Record<string, RailwayPlanEdge['stage']>
  selectedNodes?: string[]
  onCitySelect?: (cityName: string) => void
}

export default function NetworkDiagram({
  builtRouteIds,
  configuredRouteIds,
  displayRoutes = routes,
  routeStages = {},
  selectedNodes = [],
  onCitySelect,
}: Props) {
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const selected = cities.find((city) => city.name === selectedCity)

  return (
    <div id="network-map" className="network-diagram">
      <div className="map-grid" />
      <div className="map-coordinate coordinate-top">46° N</div>
      <div className="map-coordinate coordinate-bottom">44° N</div>
      <svg className="network-svg" style={{ transform: `scale(${zoom})` }} viewBox="0 0 800 480" role="img" aria-label="Illustrated railway network map of Romania">
        <defs>
          <linearGradient id="route-glow" x1="0" x2="1">
            <stop offset="0%" stopColor="#0e94a0" stopOpacity=".25" />
            <stop offset="50%" stopColor="#0a7f8a" />
            <stop offset="100%" stopColor="#0e94a0" stopOpacity=".25" />
          </linearGradient>
          <filter id="soft-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path className="country-outline" d="M244.3 85.3 L274.6 69.3 L317.9 77.6 L362.7 77.9 L395.2 96.2 L419.1 84.7 L470.8 77.5 L488.4 59.9 L518 59.9 L539.3 67.3 L561 89.5 L583.2 121.1 L623.6 165.7 L625.8 198.6 L618.4 230.7 L630.9 264.9 L662.2 278.7 L695.1 266.6 L726.8 279.5 L728.5 298.8 L694.5 315 L673.3 308 L653.7 398.4 L612.5 390.6 L561.6 363.3 L479.2 380.7 L444.4 399.9 L341.6 395.9 L287.9 384.2 L260.7 389.7 L240.6 358.9 L227.8 345.8 L244 333.1 L226.7 323.8 L204.8 340.6 L163.9 318.8 L158.4 287.9 L115.8 270.3 L108 246.4 L70 216.9 L126.1 202.8 L168.5 151.9 L201.6 101.1 Z" />
        <path className="country-relief" d="M180 248 C225 211 249 158 305 154 C352 150 371 197 412 201 C455 205 465 166 511 162 C544 159 559 185 591 202 M218 288 C265 263 296 220 341 215 C379 211 393 246 429 247 C470 248 496 214 534 222 C566 229 578 257 609 273" />
        <path className="country-river" d="M112 278 C181 298 238 330 302 345 C368 361 433 354 493 367 C545 378 590 375 652 392" />
        {displayRoutes.map((route) => {
          const a = cities.find((city) => city.name === route.from)!
          const b = cities.find((city) => city.name === route.to)!
          const isSelected = builtRouteIds.some((id) => String(id) === route.id)
          const isConfigured = configuredRouteIds?.includes(route.id) ?? false
          const stage = routeStages[route.id]
          return (
            <line
              key={route.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`rail-line ${isConfigured ? 'rail-line-configured' : 'rail-line-unconfigured'} ${isSelected ? 'rail-line-selected' : ''} ${stage ? `rail-line-${stage}` : ''}`}
              aria-label={`${route.from} to ${route.to}${isConfigured ? ', included in simulation' : ''}${stage ? `, ${stage} stage` : ''}`}
            />
          )
        })}
        {cities.map((city) => {
          const nodeIndex = selectedNodes.indexOf(city.name)
          const nodeRole = nodeIndex >= 0 ? `NODE ${nodeIndex + 1}` : ''
          return (
            <g
              key={city.name}
              className={`city-marker ${selectedCity === city.name ? 'city-marker-selected' : ''} ${nodeRole ? 'city-marker-configured' : ''}`}
              onClick={() => {
                setSelectedCity((current) => current === city.name ? null : city.name)
                onCitySelect?.(city.name)
              }}
              role="button"
              tabIndex={0}
              aria-label={nodeRole ? `${nodeRole}: ${city.name}` : `Select ${city.name} for the network`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedCity(city.name)
                  onCitySelect?.(city.name)
                }
              }}
            >
              <rect
                x={city.x - 12}
                y={city.y - 20}
                width="70"
                height="40"
                fill="transparent"
                pointerEvents="all"
              />
              <circle className="city-pulse" cx={city.x} cy={city.y} r="12" />
              <circle className="city-node" cx={city.x} cy={city.y} r={city.name === 'București' ? 5 : 3.5} />
              <text x={city.x + 10} y={city.y - 9}>{city.name}</text>
              {nodeRole && <text className="city-role" x={city.x + 10} y={city.y + 3}>{nodeRole}</text>}
            </g>
          )
        })}
      </svg>
      {selected && (
        <div className="map-city-popover">
          <button className="popover-dismiss" onClick={() => setSelectedCity(null)} aria-label="Close station details">×</button>
          <span className="eyebrow">STATION</span>
          <strong>{selected.name}</strong>
          <span>{selected.shortName} · Romania</span>
        </div>
      )}
      <div className="map-legend">
        <span><i className="legend-line legend-line-quantum" /> Chosen by QAOA</span>
        <span><i className="legend-line legend-line-connector" /> Classical connector</span>
        <span><i className="legend-line legend-line-extra" /> Extra (leftover budget)</span>
        <span><i className="legend-line legend-line-candidate" /> Candidate</span>
      </div>
      <div className="map-controls">
        <button onClick={() => setZoom((value) => Math.min(1.25, value + .08))} aria-label="Zoom in"><Plus size={15} /></button>
        <button onClick={() => setZoom((value) => Math.max(.85, value - .08))} aria-label="Zoom out"><Minus size={15} /></button>
        <button onClick={() => { setZoom(1); setSelectedCity(null) }} aria-label="Reset map view"><LocateFixed size={15} /></button>
      </div>
      <button className="map-layer-button" onClick={() => setZoom(1)}>Network view <ChevronDown size={13} /></button>
    </div>
  )
}
