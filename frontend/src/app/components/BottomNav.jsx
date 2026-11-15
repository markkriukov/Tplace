function BottomNav({ isVisible, navItems, activeNav, setActiveNav }) {
  if (!isVisible) return null

  return (
    <nav className="bottom-nav" aria-label={navItems.map((item) => item.label).join(', ')}>
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-btn ${activeNav === item.id ? 'nav-active' : ''}`}
          onClick={() => setActiveNav(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}

export default BottomNav
