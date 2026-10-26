import React from "react";

export default function Badge({
  children,
  variant = "default",
  size = "sm",
  className = "",
}) {
  const sizes = {
    xs: "px-2 py-0.5 text-[10px]",
    sm: "px-2.5 py-1 text-xs",
    md: "px-3 py-1.5 text-xs font-semibold",
  };

  const variants = {
    default:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
    pink:
      "bg-[#FCE7F3] text-[#D946A8] dark:bg-[#D946A8]/20 dark:text-[#f472c1] border border-[#FCE7F3] dark:border-[#D946A8]/30",
    purple:
      "bg-[#EDE9FE] text-[#7C5CFC] dark:bg-[#7C5CFC]/20 dark:text-[#a58efd] border border-[#EDE9FE] dark:border-[#7C5CFC]/30",
    high:
      "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60",
    medium:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60",
    low:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60",
    info:
      "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400 border border-sky-200 dark:border-sky-900/60",
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${sizes[size]} ${variants[variant] || variants.default} ${className}`}
    >
      {children}
    </span>
  );
}
