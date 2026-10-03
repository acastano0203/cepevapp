import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardBody, CardHeader, Input, KpiCard, Select, Table, Td, Tr } from '@/components/ui'
import { paymentsApi, peopleApi } from '@/lib/api'
import { todayISO } from '@/lib/utils'
import { IGNORED_HEADERS, buildImport, decodeCsv, detectKind, parseCsv } from './importPeople'

const KINDS = [
  { value: 'Cepevista', label: 'Cepevistas' },
  { value: 'Colportor', label: 'Colportores' },
]
const ACTION_TONES = { crear: 'green', actualizar: 'navy', error: 'red' }
const PREVIEW_LIMIT = 300

/**
 * Carga el CSV que genera el botón «Excel» de Cepevistas o Colportores.
 * Crea las fichas nuevas, actualiza las existentes (por documento o correo)
 * y, si se pide, abre la cuenta de pagos de las nuevas.
 */
export function ImportTab() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [records, setRecords] = useState(null)
  const [kind, setKind] = useState('Cepevista')
  const [context, setContext] = useState({ existing: [], teams: [] })
  const [loading, setLoading] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [openAccounts, setOpenAccounts] = useState(true)
  const [entryDate, setEntryDate] = useState(todayISO())
  const [progress, setProgress] = useState(null) // { done, total }
  const [result, setResult] = useState(null)

  /** Lee las fichas actuales del tipo para decidir qué se crea y qué se actualiza. */
  const loadContext = async (nextKind) => {
    const [existing, teams] = await Promise.all([
      peopleApi.registry(nextKind),
      nextKind === 'Colportor' ? peopleApi.teams() : Promise.resolve([]),
    ])
    setContext({ existing, teams })
  }

  const chooseFile = async (selected) => {
    setResult(null)
    setFile(selected ?? null)
    setRecords(null)
    if (!selected) return
    setLoading(true)
    try {
      const parsed = parseCsv(decodeCsv(await selected.arrayBuffer()))
      const detected = detectKind(parsed[0] ?? []) ?? kind
      setKind(detected)
      await loadContext(detected)
      setRecords(parsed)
    } catch (error) {
      toast.error('No se pudo leer el archivo: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const changeKind = async (nextKind) => {
    setKind(nextKind)
    if (!records) return
    setLoading(true)
    try { await loadContext(nextKind) } finally { setLoading(false) }
  }

  const plan = useMemo(() => (records ? buildImport(records, { kind, ...context }) : null), [records, kind, context])
  const rows = plan?.rows ?? []
  const valid = rows.filter((row) => row.action !== 'error')
  const counts = {
    crear: rows.filter((row) => row.action === 'crear').length,
    actualizar: rows.filter((row) => row.action === 'actualizar').length,
    error: rows.filter((row) => row.action === 'error').length,
    warnings: rows.filter((row) => row.warnings.length).length,
  }
  const ignored = (records?.[0] ?? []).filter((title) => IGNORED_HEADERS.includes(title.trim()))
  const preview = rows.filter((row) => !onlyProblems || row.action === 'error' || row.warnings.length)

  /** Fila por fila: un error no detiene el resto y queda en el resumen. */
  const runImport = async () => {
    const failures = []
    const accountIssues = []
    let created = 0
    let updated = 0
    setProgress({ done: 0, total: valid.length })
    for (const [index, row] of valid.entries()) {
      try {
        const saved = await peopleApi.upsert(row.payload)
        if (row.action === 'crear') {
          created += 1
          if (openAccounts && saved?.id) {
            try {
              await paymentsApi.enroll({
                person_id: saved.id, concept: kind === 'Cepevista' ? 'Mensualidad' : 'Siembra',
                entry_date: entryDate, monthly_amount: '', pay_now: false,
              })
            } catch (error) {
              accountIssues.push({ line: row.line, label: row.label, message: error.message })
            }
          }
        } else updated += 1
      } catch (error) {
        failures.push({ line: row.line, label: row.label, message: error.message })
      }
      setProgress({ done: index + 1, total: valid.length })
    }
    setProgress(null)
    setResult({ created, updated, failures, accountIssues, skipped: counts.error })
    ;[['people'], ['colporteurs'], ['payments'], ['teams'], ['dashboard'], ['audit']]
      .forEach((key) => queryClient.invalidateQueries({ queryKey: key }))
    await loadContext(kind)
    if (!failures.length) toast.success(`Importación terminada: ${created} creadas, ${updated} actualizadas`)
    else toast.error(`Importación con ${failures.length} filas rechazadas por el servidor`)
  }

  const busy = loading || Boolean(progress)

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Importar fichas desde Excel"
          description="Usa el archivo que genera el botón «Excel» en Cepevistas o Colportores. Puedes editarlo en Excel y guardarlo como CSV." />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy-200 px-4 py-5 text-center hover:bg-navy-50">
              <FileUp className="size-6 text-navy-500" aria-hidden="true" />
              <span className="text-sm font-semibold text-navy-700">{file ? file.name : 'Elegir archivo .csv'}</span>
              <span className="text-xs text-ink-soft">CSV separado por comas o punto y coma · UTF-8 o ANSI</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy}
                onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
            </label>
            <Select label="Tipo de fichas" value={kind} disabled={busy} options={KINDS}
              onChange={(event) => changeKind(event.target.value)}
              hint={records ? 'Detectado por las columnas del archivo; cámbialo si no corresponde.' : undefined} />
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Si el <strong className="text-ink">documento</strong> (o el correo) ya existe, la ficha se <strong className="text-ink">actualiza</strong>; si no, se <strong className="text-ink">crea</strong>. Lo que el archivo no trae (por ejemplo, observaciones) se conserva.</li>
            <li>Colportores: el equipo se asigna por su nombre. Cepevistas: se actualiza la licencia de conducción.</li>
            <li>No se importan alojamiento, reportes ni libros vendidos: se calculan o se registran en su módulo.</li>
          </ul>
        </CardBody>
      </Card>

      {plan?.error && <p role="alert" className="rounded-lg bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger-fg)]">{plan.error}</p>}

      {plan && !plan.error && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Fichas nuevas" value={counts.crear} tone="green" detail="Se crearán" />
            <KpiCard label="Fichas existentes" value={counts.actualizar} detail="Se actualizarán" />
            <KpiCard label="Con errores" value={counts.error} tone={counts.error ? 'red' : 'green'} detail="No se importan" onClick={() => setOnlyProblems(true)} />
            <KpiCard label="Con avisos" value={counts.warnings} tone={counts.warnings ? 'gold' : 'green'} detail="Se importan con ajustes" onClick={() => setOnlyProblems(true)} />
          </div>

          <Card>
            <CardHeader title="Vista previa"
              description={`${rows.length} filas leídas${ignored.length ? ` · columnas ignoradas: ${ignored.join(', ')}` : ''}`}
              action={<label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} /> Solo errores y avisos
              </label>} />
            <Table columns={['Fila', 'Nombre', 'Documento', 'Acción', 'Detalle']}>
              {preview.slice(0, PREVIEW_LIMIT).map((row) => (
                <Tr key={row.line}>
                  <Td className="text-ink-soft tabular-nums">{row.line}</Td>
                  <Td className="font-medium text-ink">{row.label}</Td>
                  <Td className="text-ink-soft">{row.payload.document_id ? `${row.payload.document_type} ${row.payload.document_id}` : '—'}</Td>
                  <Td><Badge tone={ACTION_TONES[row.action]}>{row.action === 'error' ? 'Error' : row.action === 'crear' ? 'Crear' : 'Actualizar'}</Badge></Td>
                  <Td className="text-xs">
                    {row.errors.map((error) => <span key={error} className="block text-[var(--color-danger-fg)]">{error}</span>)}
                    {row.warnings.map((warning) => <span key={warning} className="block text-gold-700">{warning}</span>)}
                  </Td>
                </Tr>
              ))}
            </Table>
            {preview.length > PREVIEW_LIMIT && <p className="px-6 py-3 text-xs text-ink-soft">Se muestran {PREVIEW_LIMIT} de {preview.length} filas; la importación incluye todas.</p>}
            {preview.length === 0 && <p className="px-6 py-6 text-center text-sm text-ink-soft">No hay filas con errores ni avisos.</p>}

            <div className="flex flex-wrap items-end justify-between gap-4 border-t border-[#edf1f5] px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex h-11 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={openAccounts} disabled={busy} onChange={(event) => setOpenAccounts(event.target.checked)} />
                  Abrir cuenta de pagos a las fichas nuevas ({kind === 'Cepevista' ? 'mensualidad' : 'siembra'})
                </label>
                {openAccounts && (
                  <Input label="Fecha de ingreso" type="date" className="w-44" value={entryDate} disabled={busy}
                    onChange={(event) => setEntryDate(event.target.value || todayISO())} />
                )}
              </div>
              <Button size="lg" disabled={!valid.length || busy} loading={Boolean(progress)} onClick={() => { runImport() }}>
                <Upload /> {progress ? `Importando ${progress.done} de ${progress.total}…` : `Importar ${valid.length} ${valid.length === 1 ? 'fila' : 'filas'}`}
              </Button>
            </div>
          </Card>
        </>
      )}

      {result && (
        <Card>
          <CardHeader title="Resultado de la importación"
            description={`${result.created} creadas · ${result.updated} actualizadas · ${result.failures.length} rechazadas · ${result.skipped} omitidas por errores`} />
          {[...result.failures.map((item) => ({ ...item, tone: 'red', kind: 'Rechazada' })),
            ...result.accountIssues.map((item) => ({ ...item, tone: 'gold', kind: 'Sin cuenta de pagos' }))].length > 0 && (
            <Table columns={['Fila', 'Nombre', 'Resultado', 'Motivo']}>
              {[...result.failures.map((item) => ({ ...item, tone: 'red', kind: 'Rechazada' })),
                ...result.accountIssues.map((item) => ({ ...item, tone: 'gold', kind: 'Sin cuenta de pagos' }))].map((item) => (
                <Tr key={`${item.kind}-${item.line}`}>
                  <Td className="tabular-nums">{item.line}</Td>
                  <Td>{item.label}</Td>
                  <Td><Badge tone={item.tone}>{item.kind}</Badge></Td>
                  <Td className="text-xs text-ink-soft">{item.message}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
