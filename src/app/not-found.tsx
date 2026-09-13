import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="rd-label">Not found</p>
      <h1 className="mt-3 text-[26px] font-bold tracking-tight text-ink">
        There is nothing at this address
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        The trip may have been deleted, or it belongs to another account.
      </p>
      <div className="mt-6">
        <Link href="/dashboard" className="rd-btn rd-btn-primary">
          Back to your trips
        </Link>
      </div>
    </main>
  );
}
