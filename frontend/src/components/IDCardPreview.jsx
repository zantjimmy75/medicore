import { forwardRef } from 'react'
import { ShieldCheck } from 'lucide-react'

/**
 * Print-accurate ID card preview.
 *
 * Renders at the ISO/IEC 7810 ID-1 size (85.6 mm × 54 mm) so what the
 * administrator previews matches the generated PDF. Print CSS keeps the card
 * at exact physical size.
 */
const IDCardPreview = forwardRef(function IDCardPreview(
  { card, kind = 'staff', qrDataUri, clinic, verifyUrl },
  ref,
) {
  if (!card) return null
  const isStaff = kind === 'staff'
  const subtitle = isStaff
    ? `${card.department_name || card.department || '—'} · ${(card.job_title || '').replace(/\b\w/g, (c) => c.toUpperCase())}`
    : `Patient · ${card.patient_number}`

  return (
    <div className="space-y-3">
      <div
        ref={ref}
        className="print-card mx-auto overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lift"
        style={{ width: '85.6mm', height: '54mm', maxWidth: '100%' }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between bg-medical-700 px-2.5 py-1.5 text-white">
            <div className="min-w-0">
              <p className="truncate text-[9px] font-bold uppercase tracking-wide">
                {clinic?.clinic_name || 'MediCore General Hospital'}
              </p>
              <p className="truncate text-[6.5px] text-medical-100">
                {clinic?.address || ''}
              </p>
            </div>
            <p className="shrink-0 text-[6.5px] font-semibold uppercase">
              {isStaff ? 'Staff ID' : 'Patient Card'}
            </p>
          </div>

          <div className="flex flex-1 gap-2 px-2.5 py-2">
            <div className="h-[24mm] w-[18mm] shrink-0 overflow-hidden rounded border border-ink-200 bg-ink-100">
              {card.photo_url ? (
                <img src={card.photo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-[6px] font-semibold text-ink-400">
                  NO PHOTO
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-bold leading-tight text-ink-900">
                {card.full_name}
              </p>
              <p className="truncate text-[7.5px] font-semibold text-teal-600">{subtitle}</p>
              <p className="mt-1 text-[8px] font-bold text-ink-900">
                {isStaff ? 'STAFF ID' : 'PATIENT NO'}:{' '}
                <span className="font-mono">{card.staff_id || card.patient_number}</span>
              </p>
              <p className="mt-0.5 text-[6px] leading-snug text-ink-500">
                {isStaff
                  ? `Emergency: ${card.emergency_contact_phone || clinic?.phone || 'Clinic reception'}`
                  : `Registered: ${card.registration_date ? new Date(card.registration_date).toLocaleDateString('en-GB') : '—'}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-center">
              {qrDataUri ? (
                <img src={qrDataUri} alt="Card verification QR code" className="h-[15mm] w-[15mm]" />
              ) : (
                <div className="grid h-[15mm] w-[15mm] place-items-center border border-dashed border-ink-300 text-[5px] text-ink-400">
                  QR
                </div>
              )}
              <span className="mt-0.5 text-[5px] text-ink-500">Scan to verify</span>
            </div>
          </div>

          <div className="flex items-center justify-between bg-medical-700 px-2.5 py-[3px] text-white">
            <span className="text-[5.5px]">Issued {card.issued_at ? new Date(card.issued_at).toLocaleDateString('en-GB') : '—'}</span>
            <span className="text-[5.5px]">Expires {card.expires_at ? new Date(card.expires_at).toLocaleDateString('en-GB') : '—'}</span>
            <span className="text-[5.5px] font-bold uppercase">{card.status || 'active'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50/70 px-3 py-2 text-[11px] text-ink-600">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink-700">Standard CR80 card · 85.6 × 54 mm</p>
          <p>
            The QR code contains an opaque, revocable reference only
            {verifyUrl ? ` (${verifyUrl.split('/verify/')[1]?.slice(0, 8)}…)` : ''}. No medical or
            personal data is encoded in it.
          </p>
        </div>
      </div>
    </div>
  )
})

export default IDCardPreview
