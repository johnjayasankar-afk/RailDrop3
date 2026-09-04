import { ImageResponse } from "next/og";

export const alt = "RailDrop — Know when your train gets cheaper";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#efe8d9",
        color: "#16120d",
        padding: "64px 72px",
        backgroundImage:
          "radial-gradient(900px 420px at 0% 0%, rgba(122,36,51,0.12), transparent 55%), radial-gradient(700px 380px at 100% 0%, rgba(196,165,116,0.18), transparent 50%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 36 }}>
          <div style={{ width: 10, height: 22, background: "#7a2433" }} />
          <div style={{ width: 10, height: 36, background: "#16120d" }} />
          <div style={{ width: 10, height: 22, background: "#7a2433" }} />
        </div>
        <div style={{ fontSize: 32, letterSpacing: -0.5 }}>RailDrop</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 920 }}>
        <div style={{ fontSize: 72, lineHeight: 1.02, letterSpacing: -1.5 }}>
          Know when your train gets cheaper.
        </div>
        <div style={{ fontSize: 28, color: "#5c554b", maxWidth: 760 }}>
          Live Amtrak rail fares for the trip you already booked. No invented prices.
        </div>
      </div>
      <div
        style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#5c554b" }}
      >
        <div>BOS → NYP · live board</div>
        <div>raildrop.app</div>
      </div>
    </div>,
    { ...size },
  );
}
