import { useState } from 'react'
import { useIsConnectionRestored, useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react'

export function useWalletScreen({ onWalletUpdated, onWalletTransactionsRefresh }) {
  const [activeWalletView, setActiveWalletView] = useState('overview')
  const [connectionError, setConnectionError] = useState('')
  const [tonConnectUI] = useTonConnectUI()
  const wallet = useTonWallet()
  const walletAddress = useTonAddress()
  const isConnectionRestored = useIsConnectionRestored()

  const handleWalletUpdated = (payload) => {
    onWalletUpdated?.(payload)
    onWalletTransactionsRefresh?.()
  }

  const openWalletModal = async () => {
    setConnectionError('')
    try {
      await tonConnectUI.openModal()
    } catch {
      setConnectionError('wallet.modalError')
    }
  }

  const disconnectWallet = async () => {
    setConnectionError('')
    try {
      await tonConnectUI.disconnect()
    } catch {
      setConnectionError('wallet.disconnectError')
    }
  }

  const openWalletAction = async (view) => {
    if (!isConnectionRestored) return
    setActiveWalletView(view)
    if (!wallet) await openWalletModal()
  }

  return {
    activeWalletView, setActiveWalletView, connectionError,
    wallet, walletAddress, isConnectionRestored,
    openWalletModal, disconnectWallet, openWalletAction, handleWalletUpdated,
  }
}
