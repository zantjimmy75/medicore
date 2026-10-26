import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Filter, Plus, RefreshCw, UserCog, Users } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useFetch } from '../hooks/useApi'
import SearchBar from '../components/SearchBar'
import StaffFormModal from './staff/StaffFormModal'
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
import { formatDate } from '../utils/format'
import { ROLE_LABELS } from '../utils/permissions'

export default function Staff() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const debouncedSearch = useDebounced(search)

  // Registering staff is a clinic-administrator duty; HR can still edit profiles.
  const canRegister = Boolean(user?.permissions?.can_register_staff)
  const canManage = Boolean(user?.permissions?.can_manage_staff)

  const { data, loading, error, refresh } = useFetch('/staff/', {
    search: debouncedSearch || undefined,
    department_id: departmentId || undefined,
    role: role || undefined,
    status: status || undefined,
    page,
    page_size: 15,
  })

  const { data: departments } = useFetch('/staff/departments/')

  const columns = useMemo(
    () => [
      {
        key: 'full_name',
        header: 'Staff member',
        render: (row) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.full_name} src={row.photo_url} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-800">{row.full_name}</p>
              <p className="font-mono text-[11px] text-ink-500">{row.staff_id}</p>
            </div>
          </div>
        ),
      },
      { key: 'job_title', header: 'Designation' },
      { key: 'department_name', header: 'Department' },
      {
        key: 'role',
        header: 'System role',
        render: (row) => <span className="text-xs text-ink-600">{ROLE_LABELS[row.role] || row.role}</span>,
      },
      { key: 'employment_status', header: 'Employment', render: (row) => <StatusPill value={row.employment_status} /> },
      { key: 'status', header: 'Approval', render: (row) => <StatusPill value={row.status} /> },
      {
        key: 'card',
        header: 'ID card',
        render: (row) =>
          row.active_card ? (
            <span className="text-[11px] font-medium text-emerald-700">{row.active_card.card_number}</span>
          ) : (
            <span className="text-[11px] text-ink-400">Not issued</span>
          ),
      },
    ],
    [],
  )

  const hasFilters = Boolean(search || departmentId || role || status)

  return (
    <>
      <PageHeader
        title="Staff management"
        description="Register staff, manage roles and departments, approve employment and issue QR-verified ID cards."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Staff' }]}
        actions={
          <>
            <button type="button" className="btn-outline" onClick={refresh}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </button>
            {canRegister && (
              <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Register staff
              </button>
            )}
          </>
        }
      />

      <Card className="mb-5 card-pad">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <SearchBar
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Search by name, staff ID, email, job title or department"
            className="flex-1"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Department" htmlFor="filter-department">
              <Select
                id="filter-department"
                value={departmentId}
                onChange={(event) => {
                  setDepartmentId(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All departments</option>
                {(departments?.results || []).map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="System role" htmlFor="filter-role">
              <Select
                id="filter-role"
                value={role}
                onChange={(event) => {
                  setRole(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All roles</option>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Approval" htmlFor="filter-status">
              <Select
                id="filter-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">Any status</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending approval</option>
                <option value="rejected">Rejected</option>
                <option value="inactive">Inactive</option>
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
              setDepartmentId('')
              setRole('')
              setStatus('')
              setPage(1)
            }}
          >
            <Filter className="h-3 w-3" aria-hidden="true" /> Clear all filters
          </button>
        )}
      </Card>

      {error ? (
        <Card>
          <EmptyState
            title="Could not load staff"
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
            columns={columns}
            rows={data?.results || []}
            loading={loading}
            onRowClick={(row) => navigate(`/staff/${row.staff_id}`)}
            caption="Staff directory"
            empty={
              hasFilters ? (
                <NoResults query={search} onClear={() => { setSearch(''); setDepartmentId(''); setRole(''); setStatus('') }} />
              ) : (
                <EmptyState
                  icon={Users}
                  title="No staff registered yet"
                  description="Register your first staff member to begin issuing ID cards and tracking attendance."
                  action={canRegister && (
                    <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
                      <Plus className="h-4 w-4" aria-hidden="true" /> Register staff
                    </button>
                  )}
                />
              )
            }
          />
          <Pagination pagination={data?.pagination} onChange={setPage} />
        </Card>
      )}

      {canRegister && (
        <StaffFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          departments={departments?.results || []}
          onCreated={(staff) => {
            setFormOpen(false)
            toast.success(`${staff.full_name} registered. Approve the record to issue an ID card.`)
            refresh()
            navigate(`/staff/${staff.staff_id}`)
          }}
        />
      )}
    </>
  )
}
