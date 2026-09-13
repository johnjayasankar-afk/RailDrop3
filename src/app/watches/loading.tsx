export default function WatchLoading() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8">
      <div className="skeleton h-4 w-32" />
      <div className="depart-strip mt-5">
        <span className="skeleton h-8 w-16 bg-[#2a241e]" />
        <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">to</span>
        <span className="skeleton h-8 w-16 bg-[#2a241e]" />
      </div>
      <div className="skeleton mt-4 h-12 w-64" />
      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        <div className="date-card h-24" />
        <div className="date-card h-24" />
        <div className="date-card h-24" />
      </div>
      <div className="skeleton mt-8 h-64" />
    </main>
  );
}
