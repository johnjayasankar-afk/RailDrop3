export function Sparkline({ values, label }: { values: number[]; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 168;
  const height = 40;
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 6) - 3;
    return { x, y };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const last = coords[coords.length - 1]!;
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="sparkline"
      role="img"
      aria-label={label ?? "Price trend"}
    >
      <polygon className="spark-area" points={area} />
      <polyline className="spark-line" fill="none" strokeWidth="1.75" points={line} />
      <circle className="spark-now" cx={last.x} cy={last.y} r="2.4" />
    </svg>
  );
}
