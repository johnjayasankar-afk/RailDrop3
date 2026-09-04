import { LoadingChrome } from "@/components/loading-chrome";

export default function SettingsLoading() {
  return (
    <LoadingChrome>
      <main id="main" className="mx-auto max-w-2xl px-4 py-8">
        <div className="depart-strip">
          <span className="skeleton h-8 w-14 bg-[#2a241e]" />
          <span className="depart-strip-rule" aria-hidden />
          <span className="skeleton h-8 w-16 bg-[#2a241e]" />
        </div>
        <div className="skeleton mt-6 h-10 w-40" />
        <div className="skeleton mt-3 h-4 w-64" />
        <div className="skeleton mt-8 h-36" />
        <div className="skeleton mt-4 h-28" />
      </main>
    </LoadingChrome>
  );
}
