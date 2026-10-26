import React from "react";

export default function PageHeader({
  category = "OVERVIEW",
  title,
  subtitle,
  actions,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 ${className}`}
    >
      <div>
        {category && (
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#D946A8] dark:text-[#f472c1]">
            {category}
          </p>
        )}
        <h1 className="mt-1 text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
