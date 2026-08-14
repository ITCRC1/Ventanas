"use client";

// Botón "Print / PDF" (en pantalla) + encabezado formal del documento (solo al
// imprimir). Reutilizable en Job Cost / Timeline / Timeline Detail / Planning.
export function PrintBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const printedOn = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <>
      <div className="mb-2 flex justify-end print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          🖨 Print / PDF
        </button>
      </div>
      <div className="mb-2 hidden border-b-2 border-slate-800 pb-2 print:block">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-lg font-bold">VENTANAS — {title}</div>
            {subtitle ? <div className="text-xs text-slate-600">{subtitle}</div> : null}
          </div>
          <div className="text-right text-xs text-slate-600">
            Date: <b>{printedOn}</b>
          </div>
        </div>
      </div>
    </>
  );
}
