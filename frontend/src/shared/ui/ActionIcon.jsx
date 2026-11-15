function ActionIcon({ name, size = 24 }) {
  const paths = {
    cart: 'M3 3h2l2.4 12h10.8l2-8H6',
    deposit: 'M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
    withdraw: 'M12 15V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Zm6 4v3',
    unlock: 'M7 10V7a5 5 0 0 1 9-3M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Zm6 4v3',
    settings: 'm9 3 1-1h4l1 3 2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1-1 3h-4l-1-3-2-1-3 1-2-4 2-2v-2L2 9l2-4 3 1 2-1Z',
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name] || paths.deposit} />
      {name === 'settings' && <circle cx="12" cy="12" r="3" />}
      {name === 'cart' && <><circle cx="9" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></>}
    </svg>
  )
}

export default ActionIcon
