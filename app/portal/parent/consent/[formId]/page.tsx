import { getGuardianView } from '@/lib/portal/guardian/guardian-data'
import { getChildForms } from '@/lib/portal/guardian/consent-forms'
import FormEditor from './form-editor'

export default async function ConsentFormPage(props: { params: Promise<{ formId: string }> }) {
  const { formId } = await props.params
  const v = await getGuardianView()
  const forms = await getChildForms(v.child.id)
  const entry = forms?.find((f) => f.schema.formId === formId)
  if (!entry) return <div className="mx-auto max-w-3xl px-5 py-8 text-sm text-muted">Form not found.</div>
  return <FormEditor childId={v.child.id} entry={entry} isSample={v.isSample} />
}
