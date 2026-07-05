import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'

const LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export default function App() {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const map = new maplibregl.Map({
      container: el.current!,
      style: dark ? DARK : LIGHT,
      center: [15, 30],
      zoom: 1.5,
      maxZoom: 18,
    })
    return () => map.remove()
  }, [])
  return <div ref={el} className="map" />
}
