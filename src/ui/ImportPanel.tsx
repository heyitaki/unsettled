import { useState } from 'react'
import { ImportDialog } from './ImportDialog'
import { useJsonFiles } from './useJsonFiles'

// Screenshot + JSON import/export, in their own panel above the Library. The
// screenshot drop-zone opens as a modal; JSON import/export act on the active tab.
export function ImportPanel() {
  const [importOpen, setImportOpen] = useState(false)
  const { importJson, exportJson, fileInput } = useJsonFiles()
  return (
    <section className="panel import-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Board data</span>
          <h2>Import &amp; export</h2>
        </div>
      </div>
      <div className="library-io">
        <button type="button" className="io-primary" onClick={() => setImportOpen(true)}>
          <svg viewBox="0 0 20 20" className="io-icon" aria-hidden="true">
            <rect x="2.2" y="3.5" width="15.6" height="13" rx="2.2" />
            <circle cx="6.7" cy="8" r="1.5" />
            <path d="M3 14.5 6.8 10.7 9.6 13.5 13 10 17 14" />
          </svg>
          Import screenshot
        </button>
        <div className="io-json">
          <button type="button" onClick={importJson}>
            <svg viewBox="0 0 20 20" className="io-icon" aria-hidden="true">
              <path d="M10 3 V11.5 M6.4 6.6 10 3 13.6 6.6 M4 14 V16.5 H16 V14" />
            </svg>
            Import JSON
          </button>
          <button type="button" onClick={exportJson}>
            <svg viewBox="0 0 20 20" className="io-icon" aria-hidden="true">
              <path d="M10 3 V11.5 M6.4 7.9 10 11.5 13.6 7.9 M4 15.5 H16" />
            </svg>
            Export JSON
          </button>
        </div>
        {fileInput}
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </section>
  )
}
