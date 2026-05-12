import { useState } from 'react'

export default function WatchlistSidebar({
  watchlist, currentSymbol,
  onSelectSymbol, onToggleInGroup,
  onAddGroup, onDeleteGroup, onRenameGroup,
}) {
  const [collapsed,    setCollapsed]    = useState({})
  const [addingGroup,  setAddingGroup]  = useState(false)
  const [newName,      setNewName]      = useState('')
  const [editingId,    setEditingId]    = useState(null)
  const [editName,     setEditName]     = useState('')

  function submitAddGroup() {
    const n = newName.trim()
    if (n) { onAddGroup(n); setNewName(''); setAddingGroup(false) }
  }
  function submitRename() {
    if (editName.trim()) onRenameGroup(editingId, editName.trim())
    setEditingId(null)
  }
  function toggleCollapse(id) {
    setCollapsed(p => ({ ...p, [id]: !p[id] }))
  }

  return (
    <div className="wl-sidebar">
      {/* Header */}
      <div className="wl-header">
        <span className="wl-title">自選股</span>
        <button
          className="wl-add-btn"
          onClick={() => { setAddingGroup(true); setNewName('') }}
          title="新增分類"
        >＋</button>
      </div>

      {/* New group input */}
      {addingGroup && (
        <div className="wl-new-row">
          <input
            className="wl-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="分類名稱…"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter')  submitAddGroup()
              if (e.key === 'Escape') { setAddingGroup(false); setNewName('') }
            }}
          />
          <button className="wl-ok"  onClick={submitAddGroup}>✓</button>
          <button className="wl-no"  onClick={() => setAddingGroup(false)}>✕</button>
        </div>
      )}

      {/* Groups */}
      <div className="wl-groups">
        {watchlist.groups.length === 0 && (
          <div className="wl-hint">點擊 ＋ 新增分類</div>
        )}

        {watchlist.groups.map(group => (
          <div key={group.id} className="wl-group">
            {/* Group header */}
            <div className="wl-group-hd" onClick={() => toggleCollapse(group.id)}>
              <span className="wl-arrow">{collapsed[group.id] ? '▶' : '▼'}</span>

              {editingId === group.id ? (
                <input
                  className="wl-input wl-edit"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onBlur={submitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === 'Escape') submitRename()
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className="wl-group-name"
                  onDoubleClick={e => {
                    e.stopPropagation()
                    setEditingId(group.id); setEditName(group.name)
                  }}
                  title="雙擊重新命名"
                >
                  {group.name}
                </span>
              )}

              <span className="wl-count">{group.stocks.length}</span>
              <button
                className="wl-del-btn"
                onClick={e => { e.stopPropagation(); onDeleteGroup(group.id) }}
                title="刪除分類"
              >✕</button>
            </div>

            {/* Stocks */}
            {!collapsed[group.id] && (
              <div className="wl-stocks">
                {group.stocks.length === 0 && (
                  <div className="wl-empty-group">
                    從 K 線圖 ★ 加入股票
                  </div>
                )}
                {group.stocks.map(sym => (
                  <div
                    key={sym}
                    className={`wl-row ${sym === currentSymbol ? 'current' : ''}`}
                    onClick={() => onSelectSymbol(sym)}
                  >
                    <span className="wl-sym">{sym}</span>
                    <button
                      className="wl-rm"
                      onClick={e => { e.stopPropagation(); onToggleInGroup(sym, group.id) }}
                      title="移除"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
