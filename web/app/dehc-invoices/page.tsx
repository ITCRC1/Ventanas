"use client";

import { AppShell } from "@/components/AppShell";
import { IssuerInvoicesView } from "@/components/IssuerInvoicesView";

/** La cédula jurídica de DEHC S.A. en Hacienda.
 *
 *  Va acá y no en el backend a propósito: el endpoint es por proveedor
 *  (`/invoice-receipts/by-issuer`), así que el día que otro proveedor importe
 *  tanto como éste se agrega otra pantalla de dos líneas y no se toca la API. */
const DEHC = "3101020869";

export default function DehcInvoicesPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">DEHC Invoices</h1>
        <p className="text-sm text-slate-500">
          Every invoice from DEHC in chronological order, with every line it bills and the project
          the payment was charged to. New invoices appear here as soon as the inbox ingests them.
        </p>
      </div>
      <IssuerInvoicesView issuer={DEHC} />
    </AppShell>
  );
}
