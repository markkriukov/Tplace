/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useCatalog } from '../../../src/features/catalog/hooks/useCatalog.js'

function Fixture() {
  const [mounted, setMounted] = useState(false)
  const { catalogGifts, isCatalogLoading, catalogError, catalogPagination, catalogLoadTriggerRef, retryCatalog } = useCatalog({ isCatalogView: true, searchCriteriaKey: '{}' })
  return <>
    <button onClick={() => setMounted(value => !value)}>Toggle catalog</button>
    <button onClick={retryCatalog}>Retry</button>
    <output aria-label="Gift count">{catalogGifts.length}</output>
    <output aria-label="Loading">{String(isCatalogLoading)}</output>
    <output aria-label="Error">{catalogError ?? ''}</output>
    {mounted && <>
      <div style={{ height: new URLSearchParams(location.search).has('short') ? 20 : catalogGifts.length * 80 }}>Gifts</div>
      {catalogPagination.hasMore && !catalogError && <div ref={catalogLoadTriggerRef} data-testid="sentinel" style={{ height: 1 }} />}
    </>}
  </>
}

createRoot(document.getElementById('root')).render(<Fixture />)

