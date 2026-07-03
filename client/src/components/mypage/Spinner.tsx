export function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-3 h-3 border" : "w-5 h-5 border-2";
  return <div className={`${cls} border-black/20 border-t-black rounded-full animate-spin`} />;
}
