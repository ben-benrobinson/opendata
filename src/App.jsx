import OpenDataVis from './opendata_vis'

function App() {
  return (
    <div className="nyc-shell">
      <header className="nyc-header">
        <div className="nyc-header-left">
          <div className="nyc-kicker">NYC Open Data · Live</div>
          <h1 className="nyc-title">Explore the city behind the numbers.</h1>
          <p className="nyc-subtitle">
            Tap into 311, subway, collisions, trees, and more. Load a dataset, pick your fields,
            and watch a slice of New York transform into a story.
          </p>
        </div>
        <div className="nyc-header-right">
          <div className="nyc-badge-row">
            <span className="nyc-badge">
              <span className="nyc-badge-dot" />
              <span>NYC Data Lab</span>
            </span>
            <span className="nyc-badge">
              <span>Made for quick exploration</span>
            </span>
          </div>
          <span>Powered by NYC Open Data · CSV &amp; JSON</span>
        </div>
      </header>
      <main className="nyc-vis-container">
        <OpenDataVis />
      </main>
    </div>
  )
}

export default App