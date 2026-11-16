"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center rounded-ui bg-[#1f2a44] px-4 text-sm font-medium text-white"
    >
      Print
    </button>
  );
}
