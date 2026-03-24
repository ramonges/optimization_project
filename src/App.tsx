import { useState } from 'react'
import './App.css'
import { MapNewYorkViewContainer } from './views/MapNewYorkView'
import { Model1View } from './views/Model1View'
import { Model2View } from './views/Model2View'

type ViewKey = 'map' | 'model1' | 'model2'

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('map')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1 className="app-title">Optimization project</h1>
        <nav className="nav">
          <button
            type="button"
            className={activeView === 'map' ? 'nav-item active' : 'nav-item'}
            onClick={() => setActiveView('map')}
          >
            Map New York
          </button>
          <button
            type="button"
            className={activeView === 'model1' ? 'nav-item active' : 'nav-item'}
            onClick={() => setActiveView('model1')}
          >
            Model1
          </button>
          <button
            type="button"
            className={activeView === 'model2' ? 'nav-item active' : 'nav-item'}
            onClick={() => setActiveView('model2')}
          >
            Model2
          </button>
        </nav>
      </aside>
      <main className="main-panel">
        {activeView === 'map' ? <MapNewYorkViewContainer /> : null}
        {activeView === 'model1' ? <Model1View /> : null}
        {activeView === 'model2' ? <Model2View /> : null}
      </main>
    </div>
  )
}

export default App
