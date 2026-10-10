import { useState, useEffect, useRef } from 'react'
import { api, Transaction, Project } from '../api/client'
import { format } from 'date-fns'

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedProject, setSelectedProject] = useState<number | undefined>(undefined)
  const [untaggedOnly, setUntaggedOnly] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [projectSearchTerm, setProjectSearchTerm] = useState('')
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  // Tag changes are auto-saved: per-transaction save status plus bookkeeping to keep PATCHes ordered
  const [saveStatus, setSaveStatus] = useState<Record<number, 'saving' | 'saved' | 'error'>>({})
  const saveSeq = useRef<Record<number, number>>({})
  const saveChain = useRef<Record<number, Promise<void>>>({})
  const editorRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [csvPreview, setCsvPreview] = useState<{ columns: string[]; sample_rows: any[] } | null>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [draggedField, setDraggedField] = useState<string | null>(null)
  
  // Define field order: Date first, then Amount, then others
  const [fieldOrder, setFieldOrder] = useState<string[]>([
    'date',
    'amount',
    'transaction_type',
    'debit',
    'credit',
    'reference',
    'description',
    'currency',
    'account_number',
    'statement_number'
  ])
  
  const fieldConfig: Record<string, { label: string; required: boolean; helpText?: string }> = {
    date: { label: 'Date', required: true },
    amount: { label: 'Amount', required: true, helpText: 'Or use Transaction Type + Amount, or Debit/Credit columns' },
    transaction_type: { label: 'Transaction Type (Debit or Credit)', required: false, helpText: 'Column containing "Debit" or "Credit" text. If "Debit", amount will be negative. If "Credit", amount will be positive.' },
    debit: { label: 'Debit (will be negative)', required: false },
    credit: { label: 'Credit (will be positive)', required: false },
    reference: { label: 'Reference', required: false },
    description: { label: 'Description', required: false },
    currency: { label: 'Currency', required: false, helpText: 'Defaults to EUR if not specified' },
    account_number: { label: 'Account Number', required: false },
    statement_number: { label: 'Statement Number', required: false }
  }
  const [uploadBatches, setUploadBatches] = useState<Array<{
    upload_batch_id: string
    upload_type: string
    transaction_count: number
    created_at: string
    account_number?: string
    statement_number?: string
  }>>([])
  const [showBatchesModal, setShowBatchesModal] = useState(false)

  useEffect(() => {
    loadTransactions()
    loadProjects()
    loadUploadBatches()
  }, [selectedProject, untaggedOnly])

  const loadUploadBatches = async () => {
    try {
      const data = await api.getUploadBatches()
      setUploadBatches(data)
    } catch (error) {
      console.error('Failed to load upload batches:', error)
    }
  }

  const loadTransactions = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.getTransactions(
        selectedProject ? { project_id: selectedProject } : undefined
      )
      // Applied at load time only, so a row you just tagged stays visible until the next reload
      setTransactions(untaggedOnly ? data.filter((t) => getTagIds(t).length === 0) : data)
    } catch (error) {
      console.error('Failed to load transactions:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadProjects = async () => {
    try {
      const data = await api.getProjects()
      setProjects(data)
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
  }

  const handleMT940Upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      await api.uploadMT940(file)
      await loadTransactions()
      await loadUploadBatches()
      alert('MT940 file uploaded successfully!')
    } catch (error: any) {
      alert(`Failed to upload: ${error.response?.data?.detail || error.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleCSVFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const preview = await api.previewCSV(file)
      setCsvPreview(preview)
      setCsvFile(file)
      
      // Auto-detect column mappings
      const autoMapping: Record<string, string> = {}
      const fieldNames = ['date', 'amount', 'debit', 'credit', 'transaction_type', 'reference', 'description', 'currency', 'account_number', 'statement_number']
      
      preview.columns.forEach(col => {
        const colLower = col.toLowerCase()
        for (const field of fieldNames) {
          if (colLower.includes(field) || colLower === field) {
            if (!autoMapping[field]) {
              autoMapping[field] = col
            }
          }
        }
        // Special handling for transaction type column
        if (!autoMapping.transaction_type) {
          const colLower = col.toLowerCase()
          if (colLower.includes('debit or credit') || colLower.includes('debit/credit') || 
              colLower.includes('transaction type') || colLower === 'type' || colLower === 'd/c' || colLower === 'dc') {
            autoMapping.transaction_type = col
          }
        }
      })
      
      setColumnMapping(autoMapping)
      // Reset field order to default when opening modal
      setFieldOrder([
        'date',
        'amount',
        'transaction_type',
        'debit',
        'credit',
        'reference',
        'description',
        'currency',
        'account_number',
        'statement_number'
      ])
      setShowMappingModal(true)
    } catch (error: any) {
      alert(`Failed to preview CSV: ${error.response?.data?.detail || error.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleCSVUpload = async () => {
    if (!csvFile) return

    setUploading(true)
    try {
      await api.uploadCSV(csvFile, columnMapping)
      await loadTransactions()
      await loadUploadBatches()
      setShowMappingModal(false)
      setCsvPreview(null)
      setCsvFile(null)
      setColumnMapping({})
      alert('CSV file uploaded successfully!')
    } catch (error: any) {
      alert(`Failed to upload: ${error.response?.data?.detail || error.message}`)
    } finally {
      setUploading(false)
    }
  }

  const getTagIds = (t: Transaction): number[] =>
    t.projects ? t.projects.map((p) => p.id) : t.project_id ? [t.project_id] : []

  // Persist the full tag list for a transaction right away. The row is updated optimistically,
  // requests for the same row are sent one after another so the last change always wins on the
  // server, and a failed save re-syncs the row from the server.
  const saveTags = (transactionId: number, nextIds: number[]) => {
    const seq = (saveSeq.current[transactionId] || 0) + 1
    saveSeq.current[transactionId] = seq
    const isLatest = () => saveSeq.current[transactionId] === seq

    const nextProjects = nextIds
      .map((id) => projects.find((p) => p.id === id))
      .filter((p): p is Project => !!p)
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === transactionId
          ? { ...t, project_id: nextIds.length === 1 ? nextIds[0] : undefined, projects: nextProjects }
          : t
      )
    )
    setSaveStatus((prev) => ({ ...prev, [transactionId]: 'saving' }))

    const run = (saveChain.current[transactionId] || Promise.resolve()).then(async () => {
      try {
        await api.updateTransaction(transactionId, { project_ids: nextIds })
        if (isLatest()) {
          setSaveStatus((prev) => ({ ...prev, [transactionId]: 'saved' }))
          setTimeout(() => {
            if (!isLatest()) return
            setSaveStatus((prev) => {
              const { [transactionId]: _done, ...rest } = prev
              return rest
            })
          }, 2000)
        }
      } catch (error) {
        console.error('Failed to save tags:', error)
        // A newer save carries the full list and will settle the final state
        if (!isLatest()) return
        await loadTransactions(true)
        setSaveStatus((prev) => ({ ...prev, [transactionId]: 'error' }))
      }
    })
    saveChain.current[transactionId] = run
  }

  const closeEditor = () => {
    setEditingId(null)
    setProjectSearchTerm('')
    setShowProjectDropdown(false)
  }

  const openEditor = (transactionId: number) => {
    setEditingId(transactionId)
    setProjectSearchTerm('')
    setShowProjectDropdown(false)
  }

  const addProjectTag = (transaction: Transaction, projectId: number) => {
    const currentIds = getTagIds(transaction)
    if (currentIds.includes(projectId)) return
    const nextIds = [...currentIds, projectId]
    saveTags(transaction.id, nextIds)
    setProjectSearchTerm('')
    // Keep dropdown open if there are more projects to add
    setTimeout(() => {
      if (getFilteredProjects(nextIds).length > 0) {
        searchInputRef.current?.focus()
      } else {
        setShowProjectDropdown(false)
      }
    }, 10)
  }

  const removeProjectTag = (transaction: Transaction, projectId: number) => {
    saveTags(
      transaction.id,
      getTagIds(transaction).filter((id) => id !== projectId)
    )
  }

  const getFilteredProjects = (currentProjectIds: number[]) => {
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(projectSearchTerm.toLowerCase()) &&
        !currentProjectIds.includes(project.id)
    )
  }

  const renderSaveStatus = (transactionId: number) => {
    const status = saveStatus[transactionId]
    if (!status) return null
    return (
      <span
        className={`text-xs ml-1 ${
          status === 'error' ? 'text-red-600' : status === 'saved' ? 'text-green-600' : 'text-gray-500'
        }`}
      >
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save failed, changes reverted'}
      </span>
    )
  }

  // Tags are saved as they change, so clicking outside the editor (or pressing Escape) just closes it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        closeEditor()
      }
    }

    if (editingId !== null) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [editingId])

  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm('Are you sure you want to delete all transactions from this upload? This cannot be undone.')) {
      return
    }

    try {
      const result = await api.deleteUploadBatch(batchId)
      await loadTransactions()
      await loadUploadBatches()
      alert(`Successfully deleted ${result.deleted_count} transactions from this upload batch.`)
    } catch (error: any) {
      alert(`Failed to delete batch: ${error.response?.data?.detail || error.message}`)
    }
  }

  const handleDeleteAllTransactions = async () => {
    if (!confirm('Are you sure you want to delete ALL bank transactions? This action cannot be undone and will delete all transactions from all uploads.')) {
      return
    }

    if (!confirm('This is your final warning. All bank transactions will be permanently deleted. Continue?')) {
      return
    }

    try {
      const result = await api.deleteAllTransactions()
      await loadTransactions()
      await loadUploadBatches()
      alert(`Successfully deleted all ${result.deleted_count} transactions.`)
    } catch (error: any) {
      let errorMessage = 'Unknown error occurred'
      if (error?.response?.data?.detail) {
        errorMessage = error.response.data.detail
      } else if (error?.response?.data?.message) {
        errorMessage = error.response.data.message
      } else if (error?.message) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      } else {
        errorMessage = JSON.stringify(error)
      }
      alert(`Failed to delete all transactions: ${errorMessage}`)
      console.error('Delete all transactions error:', error)
    }
  }


  return (
    <div className="px-4 py-6">
      <div className="mb-6 flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Bank Transactions</h2>
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Project</label>
            <select
              value={untaggedOnly ? 'untagged' : selectedProject || ''}
              onChange={(e) => {
                const value = e.target.value
                setUntaggedOnly(value === 'untagged')
                setSelectedProject(value && value !== 'untagged' ? parseInt(value) : undefined)
              }}
              className="border border-gray-300 rounded-md px-3 py-2"
            >
              <option value="">All Projects</option>
              <option value="untagged">Untagged only</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Upload MT940</label>
              <input
                type="file"
                accept=".940,.txt"
                onChange={handleMT940Upload}
                disabled={uploading}
                className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Upload CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleCSVFileSelect}
                disabled={uploading}
                className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBatchesModal(true)}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm font-medium"
              >
                Manage Uploads
              </button>
              <button
                onClick={handleDeleteAllTransactions}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium"
              >
                Clear All Transactions
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Project</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      No transactions found. Upload an MT940 or CSV file to get started.
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm">
                        {editingId === t.id ? (
                          <div ref={editorRef} className="relative w-full max-w-xs">
                            <div className="flex flex-wrap gap-2 p-2 border border-gray-300 rounded-md min-h-[36px] bg-white">
                              {getTagIds(t).map((projectId) => {
                                const project = projects.find((p) => p.id === projectId)
                                return project ? (
                                  <span
                                    key={projectId}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium"
                                  >
                                    {project.name}
                                    <button
                                      type="button"
                                      onClick={() => removeProjectTag(t, projectId)}
                                      className="text-blue-600 hover:text-blue-800 focus:outline-none"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ) : null
                              })}
                              <input
                                ref={searchInputRef}
                                type="text"
                                value={projectSearchTerm}
                                onChange={(e) => {
                                  setProjectSearchTerm(e.target.value)
                                  setShowProjectDropdown(true)
                                }}
                                onFocus={() => setShowProjectDropdown(true)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    const filtered = getFilteredProjects(getTagIds(t))
                                    if (filtered.length > 0) {
                                      // Add first matching project
                                      addProjectTag(t, filtered[0].id)
                                    }
                                  } else if (e.key === 'Escape') {
                                    closeEditor()
                                  }
                                }}
                                placeholder={getTagIds(t).length === 0 ? 'Type to search projects...' : 'Add another project...'}
                                className="flex-1 min-w-[120px] border-0 outline-none focus:ring-0 text-sm"
                                autoFocus
                              />
                            </div>
                            {showProjectDropdown && getFilteredProjects(getTagIds(t)).length > 0 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                                {getFilteredProjects(getTagIds(t)).map((project) => (
                                  <button
                                    key={project.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      addProjectTag(t, project.id)
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none text-sm"
                                  >
                                    {project.name}
                                  </button>
                                ))}
                              </div>
                            )}
                            {getTagIds(t).length > 1 && (
                              <p className="mt-1 text-xs text-gray-500">
                                Amount will be split: {(t.amount / getTagIds(t).length).toFixed(2)} {t.currency} per project
                              </p>
                            )}
                            <p className="mt-1 text-xs text-gray-400">
                              Changes save automatically.{renderSaveStatus(t.id)}
                            </p>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {t.projects && t.projects.length > 0 ? (
                              t.projects.map((project) => (
                                <span
                                  key={project.id}
                                  className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium"
                                >
                                  {project.name}
                                </span>
                              ))
                            ) : (
                              <span
                                className="text-blue-600 cursor-pointer hover:underline"
                                onClick={() => openEditor(t.id)}
                              >
                                Click to tag
                              </span>
                            )}
                            {t.projects && t.projects.length > 0 && (
                              <span
                                className="text-blue-600 cursor-pointer hover:underline text-xs ml-1"
                                onClick={() => openEditor(t.id)}
                              >
                                Edit
                              </span>
                            )}
                            {renderSaveStatus(t.id)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {format(new Date(t.date), 'MMM dd, yyyy')}
                      </td>
                      <td
                        className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${
                          t.amount >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {t.amount.toFixed(2)} {t.currency}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{t.reference || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{t.description || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {t.account_number || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CSV Column Mapping Modal */}
      {showMappingModal && csvPreview && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Map CSV Columns</h3>
              
              <div className="mb-4 p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600 mb-2">Available columns in your CSV:</p>
                <div className="flex flex-wrap gap-2">
                  {csvPreview.columns.map((col) => (
                    <span key={col} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                      {col}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-3">Drag rows to reorder fields. Map each field to a column from your CSV.</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-8"></th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Field</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CSV Column</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {fieldOrder.map((fieldKey) => {
                        const field = fieldConfig[fieldKey]
                        if (!field) return null
                        
                        return (
                          <tr
                            key={fieldKey}
                            draggable
                            onDragStart={(e) => {
                              setDraggedField(fieldKey)
                              e.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragOver={(e) => {
                              e.preventDefault()
                              e.dataTransfer.dropEffect = 'move'
                              const target = e.currentTarget
                              if (draggedField && draggedField !== fieldKey) {
                                target.classList.add('opacity-50')
                              }
                            }}
                            onDragLeave={(e) => {
                              e.currentTarget.classList.remove('opacity-50')
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              e.currentTarget.classList.remove('opacity-50')
                              
                              if (draggedField && draggedField !== fieldKey) {
                                const newOrder = [...fieldOrder]
                                const draggedIndex = newOrder.indexOf(draggedField)
                                const targetIndex = newOrder.indexOf(fieldKey)
                                
                                newOrder.splice(draggedIndex, 1)
                                newOrder.splice(targetIndex, 0, draggedField)
                                
                                setFieldOrder(newOrder)
                                setDraggedField(null)
                              }
                            }}
                            onDragEnd={(e) => {
                              setDraggedField(null)
                              const rows = e.currentTarget.parentElement?.querySelectorAll('tr') || []
                              rows.forEach(row => row.classList.remove('opacity-50'))
                            }}
                            className={`cursor-move hover:bg-gray-50 ${draggedField === fieldKey ? 'opacity-50' : ''}`}
                          >
                            <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                              </svg>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <label className="text-sm font-medium text-gray-700">
                                {field.label}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                              </label>
                              {field.helpText && (
                                <p className="text-xs text-gray-500 mt-1">{field.helpText}</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={columnMapping[fieldKey] || ''}
                                onChange={(e) => setColumnMapping({ ...columnMapping, [fieldKey]: e.target.value })}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">Select column...</option>
                                {csvPreview.columns.map((col) => (
                                  <option key={col} value={col}>
                                    {col}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {csvPreview.sample_rows.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Sample data (first {csvPreview.sample_rows.length} rows):</p>
                  <div className="overflow-x-auto border rounded">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          {csvPreview.columns.map((col) => (
                            <th key={col} className="px-3 py-2 text-left border-b">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.sample_rows.map((row, idx) => (
                          <tr key={idx} className="border-b">
                            {csvPreview.columns.map((col) => (
                              <td key={col} className="px-3 py-2">
                                {row[col] || '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowMappingModal(false)
                    setCsvPreview(null)
                    setCsvFile(null)
                    setColumnMapping({})
                    setDraggedField(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCSVUpload}
                  disabled={
                    uploading || 
                    !columnMapping.date ||
                    (!columnMapping.amount && !columnMapping.debit && !columnMapping.credit) ||
                    (!!columnMapping.transaction_type && !columnMapping.amount)
                  }
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {uploading ? 'Uploading...' : 'Upload CSV'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Batches Modal */}
      {showBatchesModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">Upload Batches</h3>
                <button
                  onClick={() => setShowBatchesModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              
              {uploadBatches.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No upload batches found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Upload Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statement</th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Transactions</th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {uploadBatches.map((batch) => (
                        <tr key={batch.upload_batch_id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              batch.upload_type === 'MT940' 
                                ? 'bg-blue-100 text-blue-800' 
                                : 'bg-green-100 text-green-800'
                            }`}>
                              {batch.upload_type}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {format(new Date(batch.created_at), 'MMM dd, yyyy HH:mm')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {batch.account_number || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {batch.statement_number || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                            {batch.transaction_count}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                            <button
                              onClick={() => handleDeleteBatch(batch.upload_batch_id)}
                              className="text-red-600 hover:text-red-800 font-medium"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
