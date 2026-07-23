// Phase-2 home for placement ranking. Rendered now as a signposted placeholder
// so the right rail has a stable slot; the scoring UI lands here later.
export function AnalysisPanel() {
  return (
    <section className="panel analysis-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Draft analysis</span>
          <h2>Best picks</h2>
        </div>
        <span className="badge-soon">Phase 2</span>
      </div>
      <div className="analysis-placeholder">
        <div className="analysis-placeholder-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p>Placement ranking is coming next.</p>
        <span>
          This panel will rank the strongest settlement spots for your pick in a
          snake draft, accounting for the picks made before yours.
        </span>
      </div>
    </section>
  )
}
