import React from "react";
import Button from "./Button";

export default function ErrorState({
  title = "Unable to load data",
  message = "A system error occurred while processing your request. Please try again.",
  onRetry,
  className = "",
}) {
  return (
    <div
      className={`rounded-[20px] border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 p-6 text-center ${className}`}
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 text-xl font-bold mb-3">
        ⚠️
      </div>
      <h3 className="text-base font-bold text-rose-900 dark:text-rose-200">
        {title}
      </h3>
      <p className="mt-1 text-xs text-rose-700 dark:text-rose-300/80 max-w-lg mx-auto">
        {message}
      </p>
      {onRetry && (
        <Button
          variant="danger"
          size="sm"
          className="mt-4"
          onClick={onRetry}
        >
          Try Again
        </Button>
      )}
    </div>
  );
}
