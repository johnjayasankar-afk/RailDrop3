export default function WatchDetailLoading() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8">
      <div className="skeleton h-4 w-28" />
      <div className="depart-strip mt-5">
        <span className="skeleton h-8 w-14 bg-[#2a241e]" />
        <span className="depart-strip-rule" aria-hidden />
        <span className="skeleton h-8 w-14 bg-[#2a241e]" />
        <span className="depart-strip-rule" aria-hidden />
        <span className="skeleton h-8 w-24 bg-[#2a241e]" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="skeleton h-24" />
        ))}
      </div>
      <div className="skeleton mt-8 h-56" />
      <div className="skeleton mt-6 h-72" />
    </main>
  );
}
