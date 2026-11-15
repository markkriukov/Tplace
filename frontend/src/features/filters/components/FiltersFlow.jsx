import { forwardRef, useImperativeHandle, useState } from 'react'
import AdvancedFiltersOverlay from './AdvancedFiltersOverlay.jsx'
import QuickFilterOverlay from './QuickFilterOverlay.jsx'

/** Quick and advanced filter dialogs over one `filters` state (see useMarketplace). */
const FiltersFlow = forwardRef(function FiltersFlow({ filters, quantityLabel, showQuantity = true }, ref) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [quickFilterKey, setQuickFilterKey] = useState(null)

  useImperativeHandle(ref, () => ({
    openAdvanced: () => setIsAdvancedOpen(true),
    openQuick: (key) => setQuickFilterKey(key),
  }), [])

  return (
    <>
      <QuickFilterOverlay
        {...filters}
        quantityLabel={quantityLabel}
        showQuantity={showQuantity}
        quickFilterKey={quickFilterKey}
        closeQuickFilter={() => setQuickFilterKey(null)}
      />
      <AdvancedFiltersOverlay
        {...filters}
        quantityLabel={quantityLabel}
        showQuantity={showQuantity}
        isOpen={isAdvancedOpen}
        onClose={() => setIsAdvancedOpen(false)}
      />
    </>
  )
})

export default FiltersFlow
