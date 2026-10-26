import React from "react";

export default function Table({
  headers = [],
  children,
  emptyState,
  className = "",
}) {
  return (
    <div className={`overflow-hidden rounded-[18px] border border-slate-200/80 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200/80 dark:border-[#2E2A4A] bg-slate-50/50 dark:bg-[#171525]/40 text-slate-500 dark:text-slate-400">
              {headers.map((header, index) => (
                <th
                  key={index}
                  className="px-5 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#2E2A4A]/60">
            {children}
          </tbody>
        </table>
      </div>
      {emptyState}
    </div>
  );
}

export function TableRow({ children, className = "", onClick }) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors duration-150 hover:bg-slate-50/80 dark:hover:bg-[#27233D] ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function TableCell({ children, className = "", bold = false }) {
  return (
    <td
      className={`px-5 py-3.5 text-slate-700 dark:text-slate-300 whitespace-nowrap ${
        bold ? "font-semibold text-slate-900 dark:text-white" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
