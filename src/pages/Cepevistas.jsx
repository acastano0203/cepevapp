import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import { PeopleRegistry } from '@/features/people/PeopleRegistry'

export default function Cepevistas() {
  return (
    <>
      <PageHeader
        title="Cepevistas"
        subtitle="Fichas de los participantes del centro: datos de contacto, procedencia y alojamiento."
      >
        <TodayChip />
      </PageHeader>

      <PeopleRegistry kind="Cepevista" />
    </>
  )
}
