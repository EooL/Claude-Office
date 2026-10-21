import { createOffice } from './office.mjs'
import { defaultOfficeContext } from './office-context.mjs'
import { officeHome } from './paths.mjs'

const officeId = process.env.OFFICE_ID ?? 'default'
// The sole eager office: shared by the chat facade and all index closures.
export const defaultOffice = createOffice({ home: officeHome(officeId), cwd: defaultOfficeContext.cwd })
// Explicit factories retain opaque metadata ids; the facade has its registry id.
defaultOffice.context = Object.freeze({ ...defaultOffice.context, id: officeId })
