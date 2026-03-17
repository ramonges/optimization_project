export function Model2View() {
  return (
    <div className="model-view">
      <h2>Model2 - Realistic Expansion + Distance Constraints</h2>
      <p>
        This page mirrors your `model2.ipynb` formulation and summarizes the solved optimization
        model, constraints, and outputs.
      </p>

      <section className="model-section">
        <h3>Decision variables</h3>
        <ul>
          <li>
            <code>x1_f, x2_f, x3_f</code>: continuous expansion slots by tier for each existing
            facility.
          </li>
          <li>
            <code>y_(l,s)</code>: binary variable for building size <code>s</code> at location{' '}
            <code>l</code>.
          </li>
        </ul>
      </section>

      <section className="model-section">
        <h3>Objective</h3>
        <p>
          Minimize total cost = piecewise expansion cost + new facility build cost + under-5
          equipment cost.
        </p>
      </section>

      <section className="model-section">
        <h3>Core constraints</h3>
        <ul>
          <li>Expansion capped at 20% of current capacity.</li>
          <li>Tiered expansion costs for 0-10%, 10-15%, and 15-20% ranges.</li>
          <li>Total slots and under-5 slot minimums per zipcode must be satisfied.</li>
          <li>At most one size can be built at each candidate location.</li>
          <li>Distance conflict rule: no two selected facilities within 0.06 miles.</li>
        </ul>
      </section>

      <section className="model-section">
        <h3>Piecewise expansion tiers</h3>
        <p>
          Your notebook uses a convex tiered cost structure (increasing marginal costs), which is
          modeled with three expansion variables per facility.
        </p>
        <div className="formula-block">
          <code>
            0 &lt; x_f/n_f ≤ 0.10: (20,000 + 200n_f)·x_f/n_f
            <br />
            0.10 &lt; x_f/n_f ≤ 0.15: (20,000 + 400n_f)·x_f/n_f
            <br />
            0.15 &lt; x_f/n_f ≤ 0.20: (20,000 + 1000n_f)·x_f/n_f
          </code>
        </div>
      </section>

      <section className="model-section">
        <h3>Model size and solver run (from notebook)</h3>
        <ul>
          <li>Variables: 69,330</li>
          <li>Constraints: 21,131</li>
          <li>Solver: CBC (time limit 600s, 1% relative gap)</li>
        </ul>
      </section>

      <section className="model-section">
        <h3>Latest results (from notebook output)</h3>
        <ul>
          <li>Total minimum cost: $193,963,051</li>
          <li>Expanded facilities: 438 (722 slots added)</li>
          <li>New facilities built: 1,454</li>
          <li>New slots created: 563,600 (under-5: 281,800)</li>
          <li>Cost split: 0.5% expansion, 99.5% new builds</li>
        </ul>
      </section>

      <section className="model-section">
        <h3>Saved output files</h3>
        <ul>
          <li>
            <code>m2_expansions.csv</code>
          </li>
          <li>
            <code>m2_new_facilities.csv</code>
          </li>
          <li>
            <code>m2_zip_summary.csv</code>
          </li>
        </ul>
      </section>
    </div>
  )
}
