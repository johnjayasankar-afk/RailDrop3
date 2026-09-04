import { LoadingChrome } from "@/components/loading-chrome";

export default function DashboardLoading() {
  return (
    <LoadingChrome>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <div className="skeleton h-10 w-56" />
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-20" />
          ))}
        </div>
        <div className="depart-strip mt-8">
          <span className="skeleton h-8 w-16 bg-[#2a241e]" />
          <span className="depart-strip-rule" aria-hidden />
          <span className="skeleton h-8 w-16 bg-[#2a241e]" />
        </div>
        <div className="skeleton mt-6 h-40" />
      </main>
    </LoadingChrome>
  );
}
