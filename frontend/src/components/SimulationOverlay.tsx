import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { LoaderCircle, MapPinned } from 'lucide-react'

const funFacts = [
  'Dijkstra’s shortest-path algorithm was first published in 1959.',
  'A route planner can evaluate thousands of paths between a small set of cities.',
  'Romania’s rail network connects mountain passes, plains, and Black Sea ports.',
  'A weighted graph lets every connection account for cost, distance, or reward.',
]

type Props = {
  statusMessage: string
  intervalMs: number
}

export default function SimulationOverlay({ statusMessage, intervalMs }: Props) {
  const [factIndex, setFactIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFactIndex((current) => (current + 1) % funFacts.length)
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return (
    <motion.div
      className="simulation-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="simulation-overlay-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.section
        className="simulation-overlay-card"
        initial={{ y: 12, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ duration: 0.25 }}
      >
        <span className="simulation-overlay-icon"><MapPinned size={20} /></span>
        <LoaderCircle className="simulation-overlay-spinner" size={18} />
        <h2 id="simulation-overlay-title">Running the railway planner</h2>
        <p>QAOA optimization and network completion are running in the Python worker.</p>
        <div className="simulation-fun-fact" aria-live="polite">
          <span>ROUTE FACT</span>
          <strong key={factIndex}>{funFacts[factIndex]}</strong>
        </div>
        <div className="simulation-live-decision" aria-live="polite">
          <span>BACKEND STATUS</span>
          <strong>{statusMessage}</strong>
          <small>The planner returns optimization diagnostics after the solve completes.</small>
        </div>
      </motion.section>
    </motion.div>
  )
}
