export default function NewWatchLoading() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-8">
      <div className="skeleton h-4 w-24" />
      <div className="skeleton mt-3 h-10 w-64" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_16rem]">
        <div className="skeleton h-[28rem]" />
        <div>
          <div className="depart-strip">
            <span className="skeleton h-8 w-16 bg-[#2a241e]" />
            <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">to</span>
            <span className="skeleton h-8 w-16 bg-[#2a241e]" />
          </div>
          <div className="skeleton mt-0 h-48" />
        </div>
      </div>
    </main>
  );
}
