import React from "react";

export default function Card({
  children,
  className = "",
  padding = "p-5 md:p-6",
  hover = false,
  glass = false,
  onClick,
  ...props
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[20px] transition-all duration-200 ${
        glass
          ? "bg-white/80 dark:bg-[#211E35]/80 backdrop-blur-md"
          : "bg-white dark:bg-[#211E35]"
      } border border-slate-200/80 dark:border-[#2E2A4A] shadow-sm ${
        hover
          ? "hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer"
          : ""
      } ${padding} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }) {
  return (
    <div className={`flex items-center justify-between gap-4 mb-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children, subtitle, className = "" }) {
  return (
    <div>
      <h3 className={`text-lg font-bold text-slate-900 dark:text-white tracking-tight ${className}`}>
        {children}
      </h3>
      {subtitle && (
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}
