/**
 * Origin and destination joined by a rail line.
 *
 * Replaces a bare arrow: the dashed track reads as rail without being a
 * cartoon, and the station codes get the mono face they deserve.
 */
export function RouteLine({
  origin,
  destination,
  size = 'md',
}: {
  origin: string;
  destination: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const type = {
    sm: 'text-[15px]',
    md: 'text-[19px]',
    lg: 'text-[26px] sm:text-[34px]',
  }[size];

  const dot = {
    sm: 'size-[5px]',
    md: 'size-[6px]',
    lg: 'size-[8px]',
  }[size];

  // A fixed track, not flex-1: the line should connect the two codes, not stretch
  // across whatever space the container happens to have.
  const track = {
    sm: 'w-8',
    md: 'w-12',
    lg: 'w-20 sm:w-28',
  }[size];

  return (
    <div className="inline-flex min-w-0 items-center gap-2.5">
      <span className={`ticket font-bold tracking-tight text-ink ${type}`}>{origin}</span>

      <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
        <span className={`${dot} shrink-0 rounded-full bg-rust`} />
        <span className={`rd-rail h-px ${track}`} />
        <span className={`${dot} shrink-0 rounded-full border-2 border-rust bg-surface`} />
      </span>

      <span className={`ticket font-bold tracking-tight text-ink ${type}`}>{destination}</span>

      <span className="sr-only">
        from {origin} to {destination}
      </span>
    </div>
  );
}
