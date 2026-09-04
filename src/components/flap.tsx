export function Flap({
  children,
  className = "",
  quiet = false,
}: {
  children: string;
  className?: string;
  /** Skip flap animation — use on dense board rows */
  quiet?: boolean;
}) {
  return (
    <span className={`flap ${quiet ? "flap-quiet" : ""} ${className}`.trim()}>
      {quiet ? (
        <span>{children}</span>
      ) : (
        <span key={children} className="flap-face">
          {children}
        </span>
      )}
    </span>
  );
}
