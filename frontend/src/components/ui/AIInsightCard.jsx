import React from "react";

export default function AIInsightCard({
  title = "AI Insight",
  subtitle,
  children,
  actionText = "View analysis →",
  onAction,
  className = "",
}) {
  return (
    <div
      className={`rounded-[20px] p-5 md:p-6 ai-card-gradient relative overflow-hidden transition-all duration-200 hover:shadow-md ${className}`}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#D946A8] to-[#7C5CFC] text-white text-xs font-bold shadow-sm">
          ✦
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-[#D946A8] dark:text-[#f472c1]">
          {title}
        </span>
      </div>

      {subtitle && (
        <h4 className="text-base font-bold text-slate-900 dark:text-white mb-2">
          {subtitle}
        </h4>
      )}

      <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        {children}
      </div>

      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] dark:text-[#a58efd] hover:text-[#D946A8] dark:hover:text-[#f472c1] transition"
        >
          <span>{actionText}</span>
        </button>
      )}
    </div>
  );
}
