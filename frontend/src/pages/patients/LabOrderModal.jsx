import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, Save, Search } from 'lucide-react'
import Modal from '../../components/Modal'
import { Field, Select, Textarea } from '../../components/ui'
import api from '../../services/api'
import { formatCurrency } from '../../utils/format'

const PRIORITIES = [
  ['routine', 'Routine'],
  ['urgent', 'Urgent'],
  ['stat', 'STAT (immediate)'],
]

export default function LabOrderModal({ open, onClose, patient, consultationId, onSaved }) {
  const [tests, setTests] = useState([])
  const [categories, setCategories] = useState([])
  const [selected, setSelected] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('routine')
  const [indication, setIndication] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setSelected([])
    setQuery('')
    setCategory('')
    setPriority('routine')
    setIndication('')
    setNotes('')
    setMessage('')
    api
      .get('/laboratory/tests/')
      .then(({ data }) => {
        setTests(data.tests || [])
        setCategories(data.categories || [])
      })
      .catch(() => setTests([]))
  }, [open])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return tests.filter((test) => {
      if (category && test.category !== category) return false
      if (!term) return true
      return (
        test.name.toLowerCase().includes(term) ||
        test.code.toLowerCase().includes(term) ||
        (test.category || '').toLowerCase().includes(term)
      )
    })
  }, [tests, query, category])

  const toggle = (test) => {
    setSelected((current) =>
      current.some((row) => row.code === test.code)
        ? current.filter((row) => row.code !== test.code)
        : [...current, test],
    )
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!selected.length) {
      setMessage('Select at least one test.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const { data } = await api.post('/laboratory/requests/', {
        patient_doc_id: patient?.id,
        tests: selected.map((test) => ({ code: test.code })),
        priority,
        clinical_indication: indication,
        notes,
        consultation_doc_id: consultationId || undefined,
      })
      onSaved?.(data.request)
    } catch (err) {
      setMessage(err.friendlyMessage || 'The laboratory request could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Order laboratory tests"
      description={`Patient: ${patient?.full_name || '—'} (${patient?.patient_number || '—'}). Requests enter the laboratory workflow at "requested".`}
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="lab-order-form" className="btn-primary" disabled={busy || !selected.length}>
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Creating…' : `Create request (${selected.length})`}
          </button>
        </>
      }
    >
      <form id="lab-order-form" className="space-y-4" onSubmit={submit}>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search tests by name, code or category"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search laboratory tests"
            />
          </div>
          <Select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)} className="sm:w-56">
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-ink-200">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-500">
              No tests match. Tests are configured under Laboratory → Test catalogue.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {filtered.map((test) => {
                const isSelected = selected.some((row) => row.code === test.code)
                return (
                  <li key={test.code}>
                    <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${isSelected ? 'bg-medical-50' : 'hover:bg-ink-50'}`}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggle(test)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink-800">
                          {test.name} <span className="font-mono text-[11px] text-ink-500">{test.code}</span>
                        </span>
                        <span className="block text-[11px] text-ink-500">
                          {test.category} · {test.specimen_type} · reference {test.reference_interval || '—'}
                        </span>
                      </span>
                      {test.price ? (
                        <span className="text-xs text-ink-500">{formatCurrency(test.price)}</span>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((test) => (
              <span key={test.code} className="pill bg-medical-100 text-medical-800">
                {test.name}
              </span>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" htmlFor="lab-priority">
            <Select id="lab-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
              {PRIORITIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Clinical indication" htmlFor="lab-indication" className="sm:col-span-2">
            <Textarea
              id="lab-indication"
              rows={2}
              value={indication}
              onChange={(event) => setIndication(event.target.value)}
              placeholder="Why the test is being requested (recorded from your own notes)"
            />
          </Field>
        </div>
        <Field label="Notes for the laboratory" htmlFor="lab-notes">
          <Textarea id="lab-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
