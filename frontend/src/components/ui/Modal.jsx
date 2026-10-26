import React, { useEffect } from "react";

export default function Modal({
  isOpen = true,
  onClose,
  title,
  subtitle,
  category = "INTELLIGENCE",
  children,
  maxWidth = "max-w-2xl",
  footer,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${maxWidth} max-h-[90vh] flex flex-col bg-white dark:bg-[#211E35] rounded-[24px] border border-slate-200 dark:border-[#2E2A4A] shadow-2xl overflow-hidden z-10 animate-scaleIn`}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-slate-100 dark:border-[#2E2A4A]/80">
          <div>
            {category && (
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#D946A8] dark:text-[#f472c1]">
                {category}
              </p>
            )}
            {title && (
              <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-4 px-6 border-t border-slate-100 dark:border-[#2E2A4A]/80 bg-slate-50/50 dark:bg-[#171525]/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
