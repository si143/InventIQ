import React from "react";
import Button from "./Button";

export default function EmptyState({
  title = "No data found",
  description = "There are currently no items matching your request.",
  icon = "🔍",
  actionLabel,
  onAction,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 md:p-12 text-center rounded-[20px] bg-slate-50/50 dark:bg-[#171525]/30 border border-dashed border-slate-200 dark:border-[#2E2A4A] ${className}`}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D946A8]/10 to-[#7C5CFC]/10 text-2xl text-[#D946A8] dark:text-[#f472c1] mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 max-w-md">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button variant="gradient" className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
