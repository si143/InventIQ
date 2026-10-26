import React from "react";

export default function Button({
  children,
  variant = "gradient",
  size = "md",
  icon: Icon,
  loading = false,
  disabled = false,
  className = "",
  type = "button",
  onClick,
  ...props
}) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none active:scale-[0.98]";

  const sizes = {
    sm: "px-3 py-1.5 text-xs gap-1.5",
    md: "px-4 py-2.5 text-sm gap-2",
    lg: "px-5 py-3 text-base gap-2.5",
  };

  const variants = {
    gradient:
      "bg-gradient-to-r from-[#D946A8] to-[#7C5CFC] text-white hover:opacity-95 shadow-sm hover:shadow-md hover:shadow-[#D946A8]/20 focus:ring-[#D946A8]",
    primary:
      "bg-[#7C5CFC] text-white hover:bg-[#6a49f1] shadow-sm focus:ring-[#7C5CFC]",
    secondary:
      "bg-white dark:bg-[#211E35] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#2E2A4A] hover:bg-slate-50 dark:hover:bg-[#27233D] hover:border-slate-300 dark:hover:border-slate-600 focus:ring-slate-300",
    outline:
      "bg-transparent text-[#7C5CFC] dark:text-[#a58efd] border border-[#7C5CFC]/30 hover:bg-[#7C5CFC]/10 focus:ring-[#7C5CFC]",
    ghost:
      "bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 focus:ring-slate-300",
    danger:
      "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 focus:ring-rose-400",
    success:
      "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 focus:ring-emerald-400",
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`${baseStyles} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin h-4 w-4 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : Icon ? (
        <Icon className="w-4 h-4 shrink-0" />
      ) : null}
      <span>{children}</span>
    </button>
  );
}
