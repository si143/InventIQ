import React from "react";

export default function Skeleton({
  className = "",
  variant = "rect",
  width,
  height,
}) {
  const variants = {
    rect: "rounded-xl",
    circle: "rounded-full",
    card: "rounded-[20px]",
    text: "rounded-md h-4",
  };

  return (
    <div
      className={`animate-pulse bg-slate-200/70 dark:bg-slate-700/50 ${variants[variant]} ${className}`}
      style={{ width, height }}
    />
  );
}

export function SkeletonKPICard() {
  return (
    <div className="rounded-[20px] border border-slate-200/80 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] p-5 space-y-3 animate-pulse">
      <div className="flex justify-between items-center">
        <Skeleton variant="text" className="w-28" />
        <Skeleton variant="circle" className="w-8 h-8" />
      </div>
      <Skeleton variant="rect" className="w-20 h-8" />
      <Skeleton variant="text" className="w-36 h-3" />
    </div>
  );
}

export function SkeletonTable() {
  return (
    <div className="rounded-[18px] border border-slate-200/80 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] p-4 space-y-4 animate-pulse">
      <Skeleton variant="rect" className="w-full h-10" />
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} variant="rect" className="w-full h-12" />
      ))}
    </div>
  );
}
