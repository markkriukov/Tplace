import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { formatGramAmount } from '../../../shared/lib/gram-amount.js'
import TonWalletChip from '../components/TonWalletChip.jsx'

function WalletTransferPage({ kind, transfer, connectionError, currency = APP_CURRENCY, onBack }) {
  const { t } = useTranslation()
  const {
    amount, setAmount, configuration, payment, busy, ready, now, error, setError, statusError,
    isDeposit, fee, currentAvailable, quote, enabled, wrongNetwork, locked, canSubmit, submit, reset,
    isPaymentInProgress,
  } = transfer
  const errorLabel = error ? t(error) : ''
  return (
    <main className="tx-page" aria-label={t(`wallet.${kind}`)}>
      {onBack && <button type="button" className="tx-back-btn" onClick={onBack}>{t('nav.wallet')}</button>}
      <h1 className="tx-title">{t(`wallet.${kind}`)}</h1>
      <section className="tx-panel">
        <p className="tx-wallet-label">{t('wallet.connectedWallet')}</p>
        <TonWalletChip onError={() => setError('wallet.modalError')} />
        {connectionError && <p className="wallet-connection-error" role="alert">{t(connectionError)}</p>}
        {statusError && <p className="wallet-connection-error" role="alert">{t('wallet.statusLoadFailed')}</p>}
        {wrongNetwork && <p className="wallet-connection-error" role="alert">{t('wallet.wrongNetwork', { network: configuration.network === '-3' ? 'testnet' : 'mainnet' })}</p>}
        {ready && !enabled && <p className="tx-ledger-note">{t('wallet.unavailable')}</p>}
        <div className="tx-amount-row">
          <input type="text" inputMode="decimal" className="tx-submit-input" value={amount}
            onChange={(event) => setAmount(event.target.value)} disabled={locked}
            placeholder={`0 ${currency}`} aria-label={t(`wallet.${kind}`)} />
          {!isDeposit && <button type="button" className="tx-max-btn" disabled={locked}
            onClick={() => setAmount(formatGramAmount(quote.maxNano))}>{t('common.all')}</button>}
        </div>
        {isDeposit ? <div className="tx-quick-row">{[10, 50, 100].map((value) => (
          <button key={value} type="button" className="tx-quick-btn" disabled={locked}
            onClick={() => setAmount(String(value))}>◈ {value}</button>
        ))}</div> : <div className="tx-limit-grid">
          <div className="tx-limit-card"><p>{t('common.available')}</p><strong>{formatGramAmount(currentAvailable)} {currency}</strong></div>
          <div className="tx-limit-card"><p>{t('wallet.withdrawTotal')}</p><strong>{formatGramAmount(quote.totalNano)} {currency}</strong></div>
          <div className="tx-limit-card"><p>{t('wallet.withdrawFee')}</p><strong>{formatGramAmount(fee)} {currency}</strong></div>
          <div className="tx-limit-card"><p>{t('wallet.withdrawReceive')}</p><strong>{formatGramAmount(quote.receiveNano)} {currency}</strong></div>
        </div>}
        <p className="tx-ledger-note">{t(isDeposit ? 'wallet.depositNote' : 'wallet.withdrawNote')}</p>
        {!isDeposit && quote.error && !locked && <p role="alert">{t(`wallet.error.${quote.error}`)}</p>}
        <button type="button" className="tx-submit-btn" onClick={submit} disabled={!canSubmit}>
          {busy ? <LoadingSkeleton variant="inline" label={t('wallet.processing')} /> : t(isDeposit ? 'wallet.confirmInWallet' : 'wallet.withdraw')}
        </button>
        {payment && <div className="tx-payment-status" role="status" aria-live="polite">
          <p>{t(`wallet.status.${payment.status}`)}</p>
          <p className="tx-wallet-label">{t('wallet.paymentReference', { id: payment.id })}</p>
          <p className="tx-wallet-label">{payment.wallet_address}</p>
          {payment.tx_hash && <a target="_blank" rel="noreferrer" href={`https://${payment.network === '-3' ? 'testnet.' : ''}tonviewer.com/transaction/${payment.tx_hash}`}>{t('wallet.viewTransaction')}</a>}
        </div>}
        {error && <p className="wallet-connection-error" role="alert">{errorLabel === error ? t(`wallet.${kind}Failed`) : errorLabel}</p>}
        {payment && !busy && (!isPaymentInProgress || (isDeposit && payment.transaction?.validUntil < now)) &&
          <button type="button" className="tx-back-btn" onClick={reset}>{t('wallet.newTransfer')}</button>}
      </section>
    </main>
  )
}

export default WalletTransferPage
