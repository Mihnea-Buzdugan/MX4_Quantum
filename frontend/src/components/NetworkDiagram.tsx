import { useState } from 'react'
import { ChevronDown, LocateFixed, Minus, Plus } from 'lucide-react'
import { cities, routes } from '../data/routes'

type Props = {
  builtRouteIds: string[]
}

export default function NetworkDiagram({ builtRouteIds }: Props) {
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
            <stop offset="0%" stopColor="#0bd9e8" stopOpacity=".25" />
            <stop offset="50%" stopColor="#11e3ee" />
            <stop offset="100%" stopColor="#0bd9e8" stopOpacity=".25" />
          </linearGradient>
          <filter id="soft-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path className="country-outline" d="M92 235 L108 190 139 177 155 140 196 132 221 112 274 116 301 94 340 111 377 99 410 117 452 102 487 121 520 111 545 132 590 134 612 160 659 166 680 201 667 235 689 259 675 294 646 315 640 350 612 367 603 399 567 417 531 408 507 437 475 424 451 399 424 414 397 395 369 403 345 380 311 388 291 366 259 367 243 345 214 341 202 313 171 311 155 286 126 280 120 253 Z" />
        <path className="county-outline" d="M245 128 L257 365 M300 101 L311 386 M365 105 L369 401 M433 109 L424 408 M500 117 L475 421 M568 137 L531 408 M139 184 L661 190 M119 246 L683 252 M159 300 L649 307 M201 339 L604 360" />
        {routes.map((route) => {
          const a = cities.find((city) => city.name === route.from)!
          const b = cities.find((city) => city.name === route.to)!
          const isSelected = builtRouteIds.includes(route.id)
          return (
            <line
              key={route.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={isSelected ? 'rail-line rail-line-selected' : 'rail-line'}
            />
          )
        })}
        {cities.map((city) => (
          <g
            key={city.name}
            className={`city-marker ${selectedCity === city.name ? 'city-marker-selected' : ''}`}
            onClick={() => setSelectedCity((current) => current === city.name ? null : city.name)}
            role="button"
            tabIndex={0}
            aria-label={`Select ${city.name}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setSelectedCity(city.name)
            }}
          >
            <circle className="city-pulse" cx={city.x} cy={city.y} r="12" />
            <circle className="city-node" cx={city.x} cy={city.y} r={city.name === 'București' ? 5 : 3.5} />
            <text x={city.x + 10} y={city.y - 9}>{city.name}</text>
          </g>
        ))}
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
        <span><i className="legend-dot legend-cyan" /> Built connection</span>
        <span><i className="legend-dot legend-muted" /> Available connection</span>
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
