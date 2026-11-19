# Readable references in Aircraft Media — aligned with CBOS Rebuild v2 Rulebook B1.2

Status: **proposal for Wallace's approval**. Only the Person format below is already approved by the Rulebook and in use.

The Rulebook (B1.2, "Standard identifier/reference generation") asks for recognisable, immutable references with
approved prefixes, initials and sequence numbers, allocated by the system, unique per tenant and entity type, never
reused, never encoding names, routes, dates or status, and never parsed to decide relationships. Internal storage keys
may remain, mapped explicitly. It approves eight families (PER, CLI, ENQ, OFR, OPT, QUO, ITI, FLT). Operator, aircraft
type, aircraft and aircraft-media families are still open ("Other entity/reference families also remain open until
mapped").

## In use now (approved format)

| Record in this app | Rulebook entity | Format | Example | Notes |
| --- | --- | --- | --- | --- |
| Contact | Person | `PER-{initials}-{number}` | `PER-WF-001` | Initials from the English name (titles such as "Mr" left out). A non-English name needs its English name before a reference is given; the app does not guess. Allocated once; renaming does not change it; retired numbers are not reused. Numbering is per initials within the workspace. |

## Proposed, awaiting approval (not used until approved)

| Record in this app | Rulebook term | Proposed format | Example | Numbering |
| --- | --- | --- | --- | --- |
| Operator (organisation) | Operator | `OPR-{initials}-{number}` | `OPR-MJ-001` (Metro Jet) | Same initials rule as Client: from the English name; number distinguishes matching initials. |
| Aircraft type | Aircraft type | `TYP-{number}` | `TYP-000123` | Shared reference data, sequence across the platform library. |
| Aircraft (particular aircraft) | Aircraft | `ACF-{number}` | `ACF-000123` | Tenant-wide sequence. The registration (tail) stays a separate, changeable field: it is not identity. |
| Aircraft media (one photo or floor plan) | Aircraft media | `MED-{number}` | `MED-000456` | Tenant-wide sequence. A re-crop is a new content version of the same photo ("MED-000456 — version 2"), not a new reference. |

Padding follows the Rulebook examples: three digits for initials-based sequences, six for tenant-wide sequences, and
numbers may grow beyond the padding.

## Until these are approved

- Every record keeps its internal ID (a UUID). Exports (`aircraft-media.csv`) carry those IDs as `*_id` columns, so
  records can be matched when they move to CBOS, and leave the readable-reference columns empty.
- File names in the CBOS export folder are import assistance only, never identity (Rulebook: "Filename conventions
  are optional import assistance, not stable identity or permission"). Original file names and source folders are kept.
