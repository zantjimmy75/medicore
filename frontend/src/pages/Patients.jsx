import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Filter, Plus, RefreshCw, UserRound, Users } from 'lucide-react'
import { useFetch, useDebounced } from '../hooks/useApi'
import { useAuth } from '../context/AuthContext'
import DeregistrationQueue from './patients/DeregistrationQueue'
import { useToast } from '../context/ToastContext'
import SearchBar from '../components/SearchBar'
import PatientFormModal from './patients/PatientFormModal'
import {
  Avatar,
  Card,
  DataTable,
  EmptyState,
  Field,
  NoResults,
  PageHeader,
  Pagination,
  Select,
  StatusPill,
} from '../components/ui'
import { ageFrom, formatDate, relativeTime } from '../utils/format'

const SEXES = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['other', 'Other'],
  ['undisclosed', 'Undisclosed'],
]

const STATUSES = [
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['deceased', 'Deceased'],
  ['transferred', 'Transferred'],
]

export default function Patients() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [sex, setSex] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(params.get('new') === '1')
  const debouncedSearch = useDebounced(search)

  // Only the receptionist registers patients (server-enforced; this only hides the UI).
  const canRegister = Boolean(user?.permissions?.can_register_patients)

  const { data, loading, error, refresh } = useFetch('/patients/', {
    search: debouncedSearch || undefined,
    sex: sex || undefined,
    status: status || undefined,
    page,
    page_size: 15,
  })

  const columns = useMemo(
    () => [
      {
        key: 'full_name',
        header: 'Patient',
        render: (row) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.full_name} src={row.photo_url} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-800">{row.full_name}</p>
              <p className="font-mono text-[11px] text-ink-500">{row.patient_number}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'sex',
        header: 'Sex / age',
        render: (row) => (
          <span className="text-xs text-ink-600">
            {row.sex ? row.sex.charAt(0).toUpperCase() + row.sex.slice(1) : '—'}
            {row.age != null ? ` · ${row.age} yrs` : ''}
          </span>
        ),
      },
      {
        key: 'phone',
        header: 'Contact',
        render: (row) => <span className="text-xs text-ink-600">{row.phone || row.email || '—'}</span>,
      },
      {
        key: 'registration_date',
        header: 'Registered',
        render: (row) => (
          <span className="text-xs text-ink-500" title={formatDate(row.registration_date)}>
            {relativeTime(row.registration_date)}
          </span>
        ),
      },
      {
        key: 'last_visit_at',
        header: 'Last visit',
        render: (row) => (
          <span className="text-xs text-ink-500">{row.last_visit_at ? formatDate(row.last_visit_at) : 'Never'}</span>
        ),
      },
      { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    ],
    [],
  )

  const hasFilters = Boolean(search || sex || status)

  const closeForm = () => {
    setFormOpen(false)
    if (params.get('new')) {
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }

  return (
    <>
      <PageHeader
        title="Patients"
        description="Register patients, detect duplicates before saving, and open the full clinical record with QR patient cards."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Patients' }]}
        actions={
          <>
            <button type="button" className="btn-outline" onClick={refresh}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </button>
            {canRegister && (
              <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Register patient
              </button>
            )}
          </>
        }
      />

      {user?.permissions?.can_decide_patient_deregistration && (
        <div className="mb-5">
          <DeregistrationQueue />
        </div>
      )}

      <Card className="mb-5 card-pad">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <SearchBar
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Search by name, patient number, phone or email"
            className="flex-1"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sex" htmlFor="filter-sex">
              <Select
                id="filter-sex"
                value={sex}
                onChange={(event) => {
                  setSex(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">Any</option>
                {SEXES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="filter-status">
              <Select
                id="filter-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">Any</option>
                {STATUSES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        {hasFilters && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-medical-700 hover:underline"
            onClick={() => {
              setSearch('')
              setSex('')
              setStatus('')
              setPage(1)
            }}
          >
            <Filter className="h-3 w-3" aria-hidden="true" /> Clear filters
          </button>
        )}
      </Card>

      {error ? (
        <Card>
          <EmptyState
            title="Could not load patients"
            description={error}
            action={
              <button type="button" className="btn-outline btn-sm" onClick={refresh}>
                Try again
              </button>
            }
          />
        </Card>
      ) : (
        <Card>
          <DataTable
            caption="Patient register"
            columns={columns}
            rows={data?.results || []}
            loading={loading}
            onRowClick={(row) => navigate(`/patients/${row.patient_number}`)}
            empty={
              hasFilters ? (
                <NoResults
                  query={search}
                  onClear={() => {
                    setSearch('')
                    setSex('')
                    setStatus('')
                  }}
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title="No patients registered yet"
                  description="Register the first patient to start recording consultations, laboratory requests and appointments."
                  action={
                    canRegister && (
                      <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
                        <UserRound className="h-4 w-4" aria-hidden="true" /> Register patient
                      </button>
                    )
                  }
                />
              )
            }
          />
          <Pagination pagination={data?.pagination} onChange={setPage} />
        </Card>
      )}

      <PatientFormModal
        open={formOpen}
        onClose={closeForm}
        onCreated={(patient) => {
          closeForm()
          toast.success(`${patient.full_name} registered as ${patient.patient_number}.`)
          navigate(`/patients/${patient.patient_number}`)
        }}
      />
    </>
  )
}
