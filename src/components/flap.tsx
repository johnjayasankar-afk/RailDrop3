export function Flap({ children, className = "" }: { children: string; className?: string }) {
  return (
    <span className={`flap ${className}`.trim()}>
      <span key={children} className="flap-face">
        {children}
      </span>
    </span>
  );
}
