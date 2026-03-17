import { FACILITY_OPTIONS } from '../domain/childCare'

export function Model1View() {
  return (
    <div className="model-view">
      <h2>Model1 - Preprocessing + Idealized Inputs</h2>
      <p>
        This page mirrors your `final_preprocessing.ipynb` and summarizes how raw NYC data is
        transformed into optimization-ready inputs for Model 1 and Model 2.
      </p>

      <section className="model-section">
        <h3>Methodology choices (from notebook)</h3>
        <ul>
          <li>
            Active facilities only: keep <strong>License</strong> and{' '}
            <strong>Registration</strong>.
          </li>
          <li>
            Missing facility coordinates are imputed with USPS zipcode centroids (`pgeocode`).
          </li>
          <li>
            Under-5 capacity = infant + toddler + preschool + children (mixed-age slots included).
          </li>
          <li>
            Missing income/employment zipcodes are conservatively classified as high-demand.
          </li>
        </ul>
      </section>

      <section className="model-section">
        <h3>Desert and demand rules</h3>
        <ul>
          <li>High demand if employment rate &gt;= 60% OR avg income &lt;= $60,000.</li>
          <li>
            Desert threshold on total slots:
            <ul>
              <li>High-demand zipcode: slots &lt;= 0.5 x pop(0-12)</li>
              <li>Normal-demand zipcode: slots &lt;= (1/3) x pop(0-12)</li>
            </ul>
          </li>
          <li>To eliminate desert status: minimum slots = floor(threshold) + 1.</li>
          <li>NYC under-5 policy: slots(0-5) &gt;= ceil((2/3) x pop(0-5)).</li>
        </ul>
      </section>

      <section className="model-section">
        <h3>Model 1 expansion assumptions</h3>
        <ul>
          <li>
            Max expansion per facility: <code>min(1.2*n_f, 500 - n_f)</code>.
          </li>
          <li>
            Linearized expansion unit cost:
            <code> (20000 + 200*n_f) / n_f</code>.
          </li>
          <li>
            This follows your notebook derivation that Model 1 expansion can be represented as a
            linear cost in added slots.
          </li>
        </ul>
      </section>

      <section className="model-section">
        <h3>New facility options (used by both models)</h3>
        <table className="model-table">
          <thead>
            <tr>
              <th>Size</th>
              <th>Total slots</th>
              <th>0-5 slots</th>
              <th>Cost ($)</th>
            </tr>
          </thead>
          <tbody>
            {FACILITY_OPTIONS.map((opt) => (
              <tr key={opt.label}>
                <td>{opt.label}</td>
                <td>{opt.totalSlots}</td>
                <td>{opt.slots0to5}</td>
                <td>{opt.fixedCost.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="model-section">
        <h3>Generated output files (from preprocessing notebook)</h3>
        <ul>
          <li>
            <code>facilities_final.csv</code> - facility-level capacities + expansion parameters.
          </li>
          <li>
            <code>zipcode_params_final.csv</code> - zipcode demand class, desert flags, slot gaps.
          </li>
          <li>
            <code>potential_locations_final.csv</code> - candidate build sites for Model 2.
          </li>
        </ul>
      </section>

      <section className="model-section">
        <h3>Status</h3>
        <p>
          Model 1 page is aligned with your preprocessing logic and ready to connect to a
          dedicated Model 1 optimizer endpoint.
        </p>
      </section>
    </div>
  )
}
