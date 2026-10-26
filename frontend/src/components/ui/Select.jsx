import React from "react";

export default function Select({
  label,
  helper,
  error,
  children,
  className = "",
  containerClassName = "",
  ...props
}) {
  return (
    <div className={`space-y-1.5 ${containerClassName}`}>
      {label && (
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      <select
        className={`w-full rounded-xl border border-slate-200 dark:border-[#2E2A4A] bg-slate-50/70 dark:bg-[#171525] px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-[#211E35] focus:border-[#7C5CFC] focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 transition ${
          error ? "border-rose-400 dark:border-rose-600 focus:ring-rose-400" : ""
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p className="text-xs text-rose-500 font-medium">{error}</p>
      )}
      {helper && !error && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{helper}</p>
      )}
    </div>
  );
}
