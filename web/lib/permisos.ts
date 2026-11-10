/** Los permisos, ordenados como la barra de navegación.
 *
 * Owner, 2026-11-10: *«organiza esto por tabs y sub tabs, me pierdo con las
 * descripciones actuales»* · *«puede que tenga acceso a un sub tab pero no a
 * todos...asi que favor organiza asi para hacer click»*.
 *
 * La pantalla de Admin mostraba diecisiete casillas en dos columnas, sin
 * relación visible con las pestañas que abren. Acá cada bloque es una pestaña
 * de la barra y cada casilla es una pantalla concreta.
 *
 * ⚠️ Este archivo es PRESENTACIÓN, no la verdad. La lista de permisos sale de
 * la base (`GET /admin/permissions`); esto solo dice dónde va cada uno. Un
 * permiso que no figure acá NO desaparece: cae en el bloque «Other» con su
 * descripción de la base. Esconderlo sería la peor falla posible en una
 * pantalla de accesos — un permiso que nadie ve es un permiso que nadie revoca.
 *
 * ⚠️ Tiene que seguir a `NAV` en AppShell.tsx. Si se agrega una pestaña allá y
 * no acá, el permiso aparece igual, pero bajo «Other» en vez de con los suyos.
 */

export type BloquePermisos = {
  /** La pestaña, con el mismo nombre que en la barra. */
  tab: string;
  /** Las pantallas que abre, en el orden del menú. */
  pantallas: { code: string; label: string }[];
  /** Lo que se puede HACER ahí dentro. Separado a propósito: ver y escribir
   *  son decisiones distintas y mezclarlas es como se regala una aprobación. */
  acciones?: { code: string; label: string }[];
};

export const BLOQUES: BloquePermisos[] = [
  {
    tab: "Dashboard",
    pantallas: [{ code: "view.dashboard", label: "Dashboard" }],
  },
  {
    tab: "Job Cost",
    pantallas: [{ code: "view.jobcost", label: "Job Cost" }],
    acciones: [
      { code: "wbs.edit", label: "Create and edit WBS lines, reassign category and phase" },
    ],
  },
  {
    tab: "Timeline",
    pantallas: [
      { code: "view.timeline", label: "Timeline" },
      { code: "view.timeline.detail", label: "Timeline Detail" },
    ],
  },
  {
    tab: "Reporting",
    pantallas: [{ code: "view.reporting", label: "Reporting" }],
  },
  {
    tab: "Planning",
    pantallas: [{ code: "view.planning", label: "Planning" }],
  },
  {
    tab: "Budget Proposal",
    pantallas: [{ code: "view.budget", label: "Budget Proposal" }],
    acciones: [
      { code: "budget.edit", label: "Create budget versions" },
      { code: "schedule.edit", label: "Edit the weekly grid" },
    ],
  },
  {
    tab: "Payments",
    pantallas: [
      { code: "view.payments", label: "Short Term Payments" },
      { code: "view.disbursements", label: "Disbursements" },
      { code: "view.credits", label: "Credits" },
    ],
    acciones: [
      { code: "disb.create", label: "Create and edit draft disbursements" },
      { code: "disb.submit", label: "Submit a disbursement to corporate" },
      { code: "disb.approve", label: "Approve a disbursement" },
    ],
  },
  {
    tab: "Invoices",
    pantallas: [
      { code: "view.invoices.receipts", label: "Invoice Receipts" },
      { code: "view.invoices.applied", label: "Invoices Applied" },
      { code: "view.invoices.match", label: "Match Review" },
      { code: "view.invoices.ledger", label: "Ledger + Invoices" },
      { code: "view.invoices.manual", label: "Invoices (manual)" },
      { code: "view.invoices.dehc", label: "DEHC Invoices" },
    ],
  },
  {
    tab: "Ledger",
    pantallas: [{ code: "view.ledger", label: "Ledger" }],
    acciones: [{ code: "ledger.edit", label: "Record payments" }],
  },
  {
    tab: "Banking",
    pantallas: [
      { code: "view.banking", label: "Banks" },
      { code: "view.banking.recon", label: "Bank Reconciliation" },
      { code: "view.banking.wires", label: "US Wire Transfers" },
    ],
  },
  {
    tab: "Blog",
    pantallas: [{ code: "view.blog", label: "Blog" }],
    acciones: [{ code: "blog.post", label: "Write entries in the project log" }],
  },
  {
    tab: "Admin",
    pantallas: [{ code: "admin.users", label: "Admin — profiles and users" }],
  },
];

/** ⚠️ Estos NO son pestañas: son permisos de DATO, y por eso van aparte.
 *
 *  `bank.view` no abre la pestaña Banking —esa tiene la suya—. Decide si el
 *  PDF del Breakdown imprime el IBAN del beneficiario y si la grilla de
 *  Payments muestra la columna Bank. Confundirlo con «ver Banking» es como se
 *  le muestran números de cuenta a quien solo venía a mirar el avance.
 *
 *  `report.view` es el único de este grupo que el backend revisa de verdad: sin
 *  él, las pantallas se ven pero la API devuelve 403. */
export const DATOS: { code: string; label: string; nota: string }[] = [
  {
    code: "bank.view",
    label: "See bank details and beneficiary IBANs",
    nota: "Also controls the IBAN on the Breakdown PDF and the Bank column in Payments.",
  },
  {
    code: "report.view",
    label: "Read report data",
    nota: "Required by the API behind Dashboard, Reporting, Planning and Ledger.",
  },
];

/** Todo código que esta pantalla ya ubica. Lo que no esté acá cae en «Other». */
export const UBICADOS = new Set<string>([
  ...BLOQUES.flatMap((b) => [
    ...b.pantallas.map((p) => p.code),
    ...(b.acciones ?? []).map((a) => a.code),
  ]),
  ...DATOS.map((d) => d.code),
]);
