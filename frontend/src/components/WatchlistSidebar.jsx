import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

export default function WatchlistSidebar({
  watchlist, currentSymbol,
  onSelectSymbol, onToggleInGroup,
  onAddGroup, onDeleteGroup, onRenameGroup,
  onReorderStock,   // (groupId, fromIdx, toIdx)
}) {
  const [collapsed,    setCollapsed]    = useState({})
  const [addingGroup,  setAddingGroup]  = useState(false)
  const [newName,      setNewName]      = useState('')
  const [editingId,    setEditingId]    = useState(null)
  const [editName,     setEditName]     = useState('')
  const [nameMap,      setNameMap]      = useState({})

  // drag state
  const dragSrc = useRef(null)   // { groupId, idx }
  const [dragOver, setDragOver] = useState(null)  // { groupId, idx }

  useEffect(() => {
    fetch(`${API_BASE}/api/stocks/list`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const map = {}
          data.forEach(item => { map[item.symbol] = item.name })
          setNameMap(map)
        }
      })
      .catch(() => {})
  }, [])

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

  // ── 拖拉排序 helpers ──────────────────────────────
  function handleDragStart(e, groupId, idx) {
    dragSrc.current = { groupId, idx }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')   // Firefox 需要
  }
  function handleDragOver(e, groupId, idx) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragOver || dragOver.groupId !== groupId || dragOver.idx !== idx)
      setDragOver({ groupId, idx })
  }
  function handleDrop(e, groupId, toIdx) {
    e.preventDefault()
    const src = dragSrc.current
    if (!src || src.groupId !== groupId) return   // 跨群組暫不支援
    if (src.idx !== toIdx) onReorderStock(groupId, src.idx, toIdx)
    dragSrc.current = null; setDragOver(null)
  }
  function handleDragEnd() {
    dragSrc.current = null; setDragOver(null)
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
                {group.stocks.map((sym, si) => {
                  const isOver = dragOver?.groupId === group.id && dragOver?.idx === si
                                 && dragSrc.current?.idx !== si
                  return (
                    <div
                      key={sym}
                      draggable
                      onDragStart={e => handleDragStart(e, group.id, si)}
                      onDragOver={e  => handleDragOver(e,  group.id, si)}
                      onDrop={e      => handleDrop(e,      group.id, si)}
                      onDragEnd={handleDragEnd}
                      className={`wl-row${sym === currentSymbol ? ' current' : ''}${isOver ? ' wl-drag-over' : ''}`}
                      onClick={() => onSelectSymbol(sym)}
                    >
                      <span className="wl-handle" title="拖拉排序">⠿</span>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span className="wl-sym">{sym}</span>
                        {nameMap[sym] && (
                          <span style={{
                            fontSize: 11, color: 'var(--text-3)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>{nameMap[sym]}</span>
                        )}
                      </div>
                      <button
                        className="wl-rm"
                        onClick={e => { e.stopPropagation(); onToggleInGroup(sym, group.id) }}
                        title="移除"
                      >✕</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
